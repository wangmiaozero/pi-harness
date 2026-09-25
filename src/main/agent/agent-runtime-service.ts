/**
 * AgentSession registry + runtime. Runs exclusively in Electron Main.
 *
 * Fork: AgentSession.fork() mutates the wrapper in-place. After fork we
 * destroy the wrapper immediately so the old sessionId cannot resolve to
 * the already-forked inner session.
 */

import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { log } from '../services/logger'
import { AgentError } from '../services/errors'
import { IPC_EVENT } from '@shared/ipc/channels'
import type {
  AgentEvent,
  AgentImageAttachment,
  AgentRuntimeStatus,
  AgentStateSnapshot,
  StartAgentSessionInput,
  ToolEntry
} from '@shared/types/workspace'
import {
  hasAssistantSnapshot,
  isIdleResetEvent,
  isRunningStateEvent,
  toIpcAgentEvent
} from '@shared/workspace/agent-event-wire'
import { getToolNamesForPreset } from '@shared/workspace/tool-presets'
import { validateAgentImages } from '@shared/workspace/image-attachments'
import { resolveModelInput } from '@shared/constants/provider-presets'
import {
  loadPiCodingAgent,
  peekPiCodingAgent,
  type AgentSessionLike,
  type PiSessionManagerLike
} from './pi-sdk'
import { AgentEventBatcher, type AgentEventBatch } from './agent-event-batcher'
import { inspectRuntimeError } from '@shared/workspace/runtime-error'
import { applyWorkspacePrompt } from '@shared/workspace/workspace-context'
import {
  getSupportedThinkingLevels,
  isKnownHarnessThinkingLevel,
  resolveCompactionThinkingLevel,
  resolveThinkingLevel
} from '@shared/thinking/levels'
import { wrapWorkspaceWriteTools } from '../workspace/workspace-tool-guard'
import { getIsDev } from '../services/app-paths'
import type { SessionService } from '../sessions/session-service'
import type { AgentRuntime } from './runtime'

const IDLE_MS = 10 * 60 * 1000
const CODING_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']
/** Minimum spacing between accumulated-message snapshots relayed on message_update. */
const SNAPSHOT_WIRE_MIN_INTERVAL_MS = 200

type EventListener = (event: AgentEvent) => void
type SessionEventListener = (event: AgentEvent) => void

interface SystemPromptController {
  forceEmpty: boolean
  workspacePromptProvider: (() => string | null) | null
  appliedSignature: string
  refresh: () => Promise<void>
}

function systemPromptSignature(controller: SystemPromptController): string {
  return `${controller.forceEmpty ? 'empty' : 'normal'}\0${controller.workspacePromptProvider?.() ?? ''}`
}

export class AgentSessionWrapper {
  private listeners: EventListener[] = []
  private unsubscribe: (() => void) | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private onDestroyCallback: (() => void) | null = null
  private shutdownPromise: Promise<void> | null = null
  private pendingPromptCount = 0
  private promptAdmissionTail: Promise<void> = Promise.resolve()
  private promptErrorMessage: string | null = null
  private lastSnapshotWireAt = 0
  private forceEmptySystemPrompt = false
  private workspacePrompt = ''
  private workspacePromptProvider: (() => string | null) | null = null
  private systemPromptDirty = false
  private _alive = true

  constructor(
    public inner: AgentSessionLike,
    private readonly systemPromptController?: SystemPromptController
  ) {
    installCompactionThinkingGuard(inner)
  }

  get sessionId(): string {
    return this.inner.sessionId
  }

  isAlive(): boolean {
    return this._alive
  }

  isRunning(): boolean {
    return (
      this._alive &&
      (this.pendingPromptCount > 0 ||
        this.inner.isStreaming ||
        this.inner.isCompacting ||
        this.inner.isBashRunning)
    )
  }

  status(): AgentRuntimeStatus {
    if (!this._alive) return 'idle'
    if (this.inner.isCompacting) return 'compacting'
    if (this.isRunning()) return 'running'
    return 'idle'
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event) => {
      try {
        if (event.type === 'message_end') {
          this.promptErrorMessage = assistantErrorMessage(event.message)
        }
        if (event.type === 'agent_end') {
          /* session list refresh is triggered by the runtime service */
        }
        if (isIdleResetEvent(event.type)) this.resetIdleTimer()
        this.emit(this.throttleWireSnapshot(event as AgentEvent))
      } catch (error) {
        log.agent.error('failed to handle Pi session event:', error)
      }
    })
    this.resetIdleTimer()
  }

  /**
   * The SDK attaches the full accumulated message to every streaming delta,
   * so relaying it verbatim makes per-delta serialization cost grow with the
   * message length. The renderer only consults that snapshot to recover the
   * partial message after a mid-stream reload (its reducer ignores deltas for
   * blocks it has not seen, so a later snapshot still seeds the full state),
   * and `message_start` / `message_end` always carry authoritative copies.
   * Sending one snapshot per interval is therefore indistinguishable in
   * normal streaming while keeping message_update payloads O(delta).
   */
  private throttleWireSnapshot(event: AgentEvent): AgentEvent {
    if (!hasAssistantSnapshot(event)) return event
    const now = Date.now()
    if (now - this.lastSnapshotWireAt < SNAPSHOT_WIRE_MIN_INTERVAL_MS) {
      return { ...event, message: undefined }
    }
    this.lastSnapshotWireAt = now
    return event
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i !== -1) this.listeners.splice(i, 1)
    }
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.forceEmptySystemPrompt = force
    if (this.systemPromptController) this.systemPromptController.forceEmpty = force
    this.applyForcedEmptySystemPrompt()
  }

  setWorkspacePrompt(prompt: string | null): void {
    this.workspacePrompt = prompt ?? ''
    if (this.systemPromptController) {
      this.systemPromptController.workspacePromptProvider = () => this.workspacePrompt || null
    }
    this.applyForcedEmptySystemPrompt()
  }

  setWorkspacePromptProvider(provider: (() => string | null) | null): void {
    this.workspacePromptProvider = provider
    if (this.systemPromptController) this.systemPromptController.workspacePromptProvider = provider
    this.applyForcedEmptySystemPrompt()
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer()
    const type = command.type as string
    switch (type) {
      case 'prompt': {
        const imageError = validateAgentImages(command.images)
        if (imageError) throw new AgentError(imageError)
        const release = await this.acquirePromptAdmission()
        try {
          if (this.inner.isBashRunning) {
            throw new AgentError('Cannot send a prompt while a shell command is running')
          }
          const images = await this.prepareImages(command.images)
          let preflightAccepted = false
          let preflightSettled = false
          let promptSettled = false
          let acceptPreflight!: () => void
          let rejectPreflight!: (error: unknown) => void
          const preflight = new Promise<void>((resolve, reject) => {
            acceptPreflight = () => {
              preflightAccepted = true
              if (preflightSettled) return
              preflightSettled = true
              resolve()
            }
            rejectPreflight = (error) => {
              if (preflightSettled) return
              preflightSettled = true
              reject(error)
            }
          })
          const finishPrompt = () => {
            if (promptSettled) return
            promptSettled = true
            this.pendingPromptCount = Math.max(0, this.pendingPromptCount - 1)
            this.resetIdleTimer()
          }
          this.pendingPromptCount += 1
          this.promptErrorMessage = null
          await this.refreshSystemPrompt()
          const streamingBehavior = command.streamingBehavior as 'steer' | 'followUp' | undefined
          let prompt: Promise<void>
          try {
            prompt = this.inner.prompt(String(command.message ?? ''), {
              ...(images?.length ? { images } : {}),
              ...(streamingBehavior ? { streamingBehavior } : {}),
              source: 'rpc',
              preflightResult: (success: boolean) => {
                if (success) acceptPreflight()
              }
            })
          } catch (error) {
            finishPrompt()
            throw error
          }
          void prompt.then(
            () => {
              acceptPreflight()
              finishPrompt()
              if (!streamingBehavior) {
                const errorMessage = this.promptErrorMessage
                this.emit({
                  type: 'prompt_done',
                  success: errorMessage === null,
                  ...(errorMessage ? { errorMessage } : {})
                })
              }
            },
            (error) => {
              rejectPreflight(error)
              finishPrompt()
              if (preflightAccepted) {
                const errorMessage = inspectRuntimeError(error).userMessage
                this.emit({
                  type: 'prompt_error',
                  errorMessage
                })
                if (!streamingBehavior) {
                  this.emit({ type: 'prompt_done', success: false, errorMessage })
                }
              }
            }
          )
          await preflight
          return null
        } finally {
          release()
        }
      }
      case 'abort':
        await this.inner.abort()
        return null
      case 'get_state':
        return this.snapshot()
      case 'set_model': {
        const provider = String(command.provider ?? '')
        const modelId = String(command.modelId ?? '')
        await this.inner.modelRuntime.refresh({ allowNetwork: false })
        const model = this.inner.modelRuntime.getModel(provider, modelId)
        if (!model) throw new AgentError(`Model not found: ${provider}/${modelId}`)
        const resolvedInput = resolveModelInput({
          providerKey: model.provider,
          modelId: model.id,
          configuredInput: model.input
        })
        await this.inner.setModel({ ...model, input: [...resolvedInput] })
        return {
          id: (model as { id: string }).id,
          provider: (model as { provider: string }).provider
        }
      }
      case 'fork': {
        if (this.inner.isBashRunning) {
          throw new AgentError('Cannot fork while a shell command is running')
        }
        const entryId = String(command.entryId ?? '')
        const sessionManager = this.inner.sessionManager
        const currentSessionFile = this.inner.sessionFile
        if (!sessionManager.isPersisted()) return { cancelled: true }
        if (!currentSessionFile) throw new AgentError('Persisted session is missing a session file')
        const entry = sessionManager.getEntry(entryId)
        if (!entry) throw new AgentError('Invalid entry ID for forking')
        const sessionDir = sessionManager.getSessionDir()
        const sdk = await loadPiCodingAgent()
        let newSessionFile: string
        const typedEntry = entry as { parentId?: string | null }
        if (!typedEntry.parentId) {
          const newManager = sdk.SessionManager.create(sessionManager.getCwd(), sessionDir)
          newManager.newSession({ parentSession: currentSessionFile })
          newSessionFile = newManager.getSessionFile() as string
        } else {
          const sourceManager = sdk.SessionManager.open(currentSessionFile, sessionDir)
          const forkedPath = sourceManager.createBranchedSession(typedEntry.parentId)
          if (!forkedPath) throw new AgentError('Failed to create forked session')
          newSessionFile = forkedPath
        }
        const newSessionId = sdk.SessionManager.open(newSessionFile, sessionDir).getSessionId()
        await this.shutdown()
        return { cancelled: false, newSessionId, newSessionFile }
      }
      case 'navigate_tree': {
        if (this.inner.isBashRunning) {
          throw new AgentError('Cannot navigate while a shell command is running')
        }
        const result = await this.inner.navigateTree(String(command.targetId ?? ''), {})
        return { cancelled: result.cancelled }
      }
      case 'set_thinking_level': {
        const requested = String(command.level ?? 'off')
        const level = resolveSessionThinkingLevel(this.inner, requested)
        if (level !== 'auto' && !supportsThinkingLevel(this.inner, level)) return null
        this.inner.setThinkingLevel(level)
        if (
          level === 'xhigh' &&
          this.inner.model?.compat?.thinkingFormat === 'deepseek' &&
          this.inner.agent?.state
        ) {
          this.inner.agent.state.thinkingLevel = 'xhigh'
        }
        return null
      }
      case 'compact':
        try {
          return await this.inner.compact(command.customInstructions as string | undefined)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (message === 'Nothing to compact (session too small)') {
            return { cancelled: true, reason: 'session-too-small' }
          }
          if (message === 'Already compacted') {
            return { cancelled: true, reason: 'already-compacted' }
          }
          const runtime = inspectRuntimeError(error)
          throw new AgentError(runtime.userMessage, { kind: runtime.kind }, { recoverable: true })
        }
      case 'abort_compaction':
        this.inner.abortCompaction?.()
        return null
      case 'set_session_name': {
        const name = String(command.name ?? '').trim()
        if (!name) throw new AgentError('Session name cannot be empty')
        this.inner.setSessionName(name)
        return null
      }
      case 'get_tools': {
        const all = this.inner.getAllTools()
        const active = new Set(this.inner.getActiveToolNames())
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name)
        }))
      }
      case 'set_tools': {
        const toolNames = (command.toolNames as string[]) ?? []
        this.setForceEmptySystemPrompt(toolNames.length === 0)
        const nextToolNames =
          command.preserveExtensionTools === false
            ? toolNames
            : withExtensionTools(this.inner, toolNames)
        this.inner.setActiveToolsByName(nextToolNames)
        await this.refreshSystemPrompt()
        return null
      }
      case 'append_external_image_result':
        return this.appendExternalImageResult(command)
      case 'steer':
        {
          const imageError = validateAgentImages(command.images)
          if (imageError) throw new AgentError(imageError)
        }
        await this.inner.steer?.(
          String(command.message ?? ''),
          await this.prepareImages(command.images)
        )
        return null
      case 'follow_up':
        {
          const imageError = validateAgentImages(command.images)
          if (imageError) throw new AgentError(imageError)
        }
        await this.inner.followUp?.(
          String(command.message ?? ''),
          await this.prepareImages(command.images)
        )
        return null
      case 'get_session_stats':
        return {
          ...(this.inner.getSessionStats?.() ?? {}),
          sessionName: this.inner.sessionManager.getSessionName()
        }
      case 'set_auto_compaction':
        this.inner.setAutoCompactionEnabled(Boolean(command.enabled))
        return null
      default:
        throw new AgentError(`Unsupported command: ${type}`)
    }
  }

  snapshot(): AgentStateSnapshot {
    const model = this.inner.model
    const contextUsage = safelyRead(() => this.inner.getContextUsage?.() ?? null, null)
    const steeringMessages = safelyRead(() => this.inner.getSteeringMessages?.() ?? [], [])
    const followUpMessages = safelyRead(() => this.inner.getFollowUpMessages?.() ?? [], [])
    return {
      sessionId: this.inner.sessionId,
      sessionFile: this.inner.sessionFile ?? '',
      status: this.status(),
      isStreaming: this.inner.isStreaming,
      isPromptRunning: this.pendingPromptCount > 0,
      isBashRunning: this.inner.isBashRunning,
      isCompacting: this.inner.isCompacting,
      autoCompactionEnabled: this.inner.autoCompactionEnabled === true,
      model: model ? { id: model.id, provider: model.provider } : undefined,
      thinkingLevel: this.inner.agent.state?.thinkingLevel ?? 'off',
      contextUsage: contextUsage
        ? {
            percent: contextUsage.percent,
            contextWindow: contextUsage.contextWindow,
            tokens: contextUsage.tokens
          }
        : null,
      pendingMessageCount: this.inner.pendingMessageCount ?? 0,
      queuedMessages: {
        steering: [...steeringMessages],
        followUp: [...followUpMessages]
      }
    }
  }

  destroy(): void {
    if (!this._alive) return
    this._alive = false
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.inner.isBashRunning) this.inner.abortBash?.()
    this.unsubscribe?.()
    try {
      this.inner.dispose()
    } finally {
      this.onDestroyCallback?.()
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    if (!this._alive) return
    this.shutdownPromise = (async () => {
      this.destroy()
    })()
    return this.shutdownPromise
  }

  private emit(event: AgentEvent): void {
    const client = toIpcAgentEvent(event)
    if (!client) return
    for (const listener of this.listeners) {
      try {
        listener(client as AgentEvent)
      } catch (error) {
        log.agent.error('failed to deliver agent event:', error)
      }
    }
  }

  private async acquirePromptAdmission(): Promise<() => void> {
    const previous = this.promptAdmissionTail
    let release!: () => void
    this.promptAdmissionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    return release
  }

  private async prepareImages(value: unknown): Promise<AgentImageAttachment[] | undefined> {
    const images = value as AgentImageAttachment[] | undefined
    if (!images?.length) return undefined
    if (this.inner.settingsManager?.getBlockImages?.()) {
      throw new AgentError('Image input is disabled in Pi settings')
    }

    const currentModel = this.inner.model
    let model = currentModel
    if (!this.inner.isStreaming && model) {
      await this.inner.modelRuntime.refresh({ allowNetwork: false })
      const refreshed = this.inner.modelRuntime.getModel(model.provider, model.id)
      if (!refreshed) throw new AgentError(`Model not found: ${model.provider}/${model.id}`)
      model = refreshed
    }
    if (!model) throw new AgentError('No model selected')

    const effectiveInput = resolveModelInput({
      providerKey: model.provider,
      modelId: model.id,
      configuredInput: model.input
    })
    if (!effectiveInput.includes('image')) {
      throw new AgentError(`Model does not support image input: ${model.provider}/${model.id}`)
    }
    if (!sameInputCapabilities(currentModel?.input, effectiveInput)) {
      await this.inner.setModel({ ...model, input: [...effectiveInput] })
    }
    return images
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (this.isRunning()) {
        this.resetIdleTimer()
        return
      }
      void this.shutdown().catch((error) => {
        log.agent.warn('idle shutdown failed:', error)
      })
    }, IDLE_MS)
  }

  private applyForcedEmptySystemPrompt(): void {
    this.systemPromptDirty = this.systemPromptController
      ? systemPromptSignature(this.systemPromptController) !==
        this.systemPromptController.appliedSignature
      : true
    if (!this.inner.agent.state) return
    try {
      if (this.forceEmptySystemPrompt) {
        this.inner.agent.state.systemPrompt = ''
        return
      }
      this.inner.agent.state.systemPrompt = applyWorkspacePrompt(
        this.inner.agent.state.systemPrompt,
        this.workspacePromptProvider?.() ?? (this.workspacePrompt || null)
      )
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      // Pi >= 0.87 exposes state.systemPrompt as a getter. The supported
      // resource-loader override is refreshed just before the next prompt.
    }
  }

  private async refreshSystemPrompt(): Promise<void> {
    this.applyForcedEmptySystemPrompt()
    if (!this.systemPromptController || !this.systemPromptDirty) return
    await this.systemPromptController.refresh()
    this.systemPromptController.appliedSignature = systemPromptSignature(
      this.systemPromptController
    )
    this.systemPromptDirty = false
  }

  private appendExternalImageResult(command: Record<string, unknown>): {
    userEntryId: string
    assistantEntryId: string
  } {
    const manager = this.inner.sessionManager
    if (typeof manager.appendMessage !== 'function') {
      throw new AgentError('Installed Pi version cannot persist generated images')
    }
    const prompt = typeof command.prompt === 'string' ? command.prompt.trim() : ''
    const provider = typeof command.provider === 'string' ? command.provider.trim() : ''
    const modelId = typeof command.modelId === 'string' ? command.modelId.trim() : ''
    const sourceImages = Array.isArray(command.sourceImages) ? command.sourceImages : []
    const resultImage = command.resultImage as AgentImageAttachment | undefined
    const imageError = validateAgentImages([...sourceImages, ...(resultImage ? [resultImage] : [])])
    if (!prompt || prompt.length > 8_000) throw new AgentError('Invalid image prompt')
    if (!provider || provider.length > 128 || !modelId || modelId.length > 256) {
      throw new AgentError('Invalid image model')
    }
    if (sourceImages.length > 1 || imageError || !resultImage) {
      throw new AgentError(imageError ?? 'Invalid image result')
    }

    const timestamp = Date.now()
    const userEntryId = manager.appendMessage({
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...sourceImages.map((image) => ({
          type: 'image' as const,
          data: image.data,
          mimeType: image.mimeType
        }))
      ],
      timestamp
    })
    const assistantEntryId = manager.appendMessage({
      role: 'custom',
      customType: 'pi-harness-image-result',
      content: [{ type: 'image', data: resultImage.data, mimeType: resultImage.mimeType }],
      display: true,
      details: { provider, model: modelId },
      timestamp: Date.now()
    })
    this.inner.refreshContext?.()
    return { userEntryId, assistantEntryId }
  }
}

function assistantErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const message = value as { role?: unknown; stopReason?: unknown; errorMessage?: unknown }
  if (message.role !== 'assistant') return null
  if (message.stopReason !== 'error' && typeof message.errorMessage !== 'string') return null
  return typeof message.errorMessage === 'string' && message.errorMessage.trim()
    ? inspectRuntimeError(message.errorMessage).userMessage
    : 'Agent error'
}

function sameInputCapabilities(
  left: readonly ('text' | 'image')[] | undefined,
  right: readonly ('text' | 'image')[]
): boolean {
  return Boolean(
    left?.length === right.length && left.every((value) => right.includes(value) === true)
  )
}

function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return []
  const coding = new Set(CODING_TOOL_NAMES)
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !coding.has(name))
  return [...new Set([...toolNames, ...extensionToolNames])]
}

function safelyRead<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

function supportsThinkingLevel(session: AgentSessionLike, level: string): boolean {
  if (typeof session.getAvailableThinkingLevels !== 'function') return true
  try {
    const levels = session.getAvailableThinkingLevels()
    return !Array.isArray(levels) || levels.length === 0 || levels.map(String).includes(level)
  } catch {
    return true
  }
}

function sessionThinkingSource(session: AgentSessionLike): readonly string[] {
  const available =
    typeof session.getAvailableThinkingLevels === 'function'
      ? session.getAvailableThinkingLevels()
      : null
  if (Array.isArray(available) && available.length > 0) return available
  return getSupportedThinkingLevels(session.model?.thinkingLevelMap)
}

function resolveSessionThinkingLevel(session: AgentSessionLike, requested: string): string {
  const resolved = resolveThinkingLevel({
    requested,
    supportedLevels: sessionThinkingSource(session)
  })
  logThinking('Thinking', requested, resolved, session)
  return resolved
}

function resolveModelThinkingLevel(requested: string, model: unknown): string {
  const map =
    model && typeof model === 'object'
      ? (model as { thinkingLevelMap?: Partial<Record<string, string | null>> }).thinkingLevelMap
      : undefined
  const resolved = resolveThinkingLevel({ requested, supportedLevels: map })
  logThinking('Thinking', requested, resolved, model)
  return resolved
}

function installCompactionThinkingGuard(session: AgentSessionLike): void {
  const original = session.compact.bind(session)
  session.compact = async (instructions?: string) => {
    const current = String(session.agent?.state?.thinkingLevel ?? session.thinkingLevel ?? 'off')
    const compactionRequested = resolveCompactionThinkingLevel(current)
    const next = resolveThinkingLevel({
      requested: compactionRequested,
      supportedLevels: sessionThinkingSource(session)
    })
    const restore = next !== current && supportsThinkingLevel(session, next)
    if (restore) session.setThinkingLevel(next)
    logThinking('Compaction', current, next, session, { sessionThinking: current })
    try {
      return await original(instructions)
    } finally {
      if (restore && supportsThinkingLevel(session, current)) {
        session.setThinkingLevel(current)
      }
    }
  }
}

function isDevLoggingEnabled(): boolean {
  try {
    return getIsDev()
  } catch {
    return false
  }
}

function logThinking(
  label: 'Thinking' | 'Compaction',
  requested: string,
  resolved: string,
  source: AgentSessionLike | unknown,
  extra?: Record<string, string>
): void {
  if (!isDevLoggingEnabled()) return
  if (!isKnownHarnessThinkingLevel(requested)) {
    log.agent.warn(`[${label}] unknown thinking level, falling back`, { requested, resolved })
  }
  const model =
    source && typeof source === 'object' && 'model' in source
      ? (source as AgentSessionLike).model
      : source && typeof source === 'object'
        ? (source as { id?: string; provider?: string })
        : null
  log.agent.info(`[${label}]`, {
    requested,
    resolved,
    provider: model && 'provider' in model ? String(model.provider ?? '') : '',
    model: model && 'id' in model ? String(model.id ?? '') : '',
    ...extra
  })
}

/** Pi Coding Agent-backed implementation of the Pi-Harness runtime boundary. */
export class AgentRuntimeService implements AgentRuntime {
  private registry = new Map<string, AgentSessionWrapper>()
  private sessionListeners = new Map<string, Set<SessionEventListener>>()
  private startLocks = new Map<
    string,
    Promise<{ session: AgentSessionWrapper; realSessionId: string }>
  >()
  private getWindow: () => BrowserWindow | null = () => null

  constructor(
    private readonly sessions: SessionService,
    private readonly workspace?: {
      getPrompt?: (sessionId: string) => string | null
      assertWritable?: (target: string, sessionId: string) => Promise<string>
      /** Last wrap step for agent sessions (policy guard runs after the workspace guard). */
      wrapSessionTools?: (session: AgentSessionLike, sessionId: string) => void
    }
  ) {}

  diagnostics(): { implementation: 'pi'; sdkLoaded: boolean } {
    return { implementation: 'pi', sdkLoaded: peekPiCodingAgent() !== null }
  }

  attachWindow(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow
  }

  listRunning(): string[] {
    return [...this.registry.values()].filter((w) => w.isRunning()).map((w) => w.sessionId)
  }

  get(sessionId: string): AgentSessionWrapper | undefined {
    return this.registry.get(sessionId)
  }

  subscribe(sessionId: string, listener: SessionEventListener): () => void {
    const listeners = this.sessionListeners.get(sessionId) ?? new Set<SessionEventListener>()
    listeners.add(listener)
    this.sessionListeners.set(sessionId, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.sessionListeners.delete(sessionId)
    }
  }

  async getState(sessionId: string): Promise<AgentStateSnapshot | null> {
    const wrapper = this.registry.get(sessionId)
    if (!wrapper?.isAlive()) return null
    return wrapper.snapshot()
  }

  async start(input: StartAgentSessionInput): Promise<{ sessionId: string; cwd: string }> {
    const sdk = await loadPiCodingAgent()
    let sessionManager: PiSessionManagerLike
    let lockKey: string

    if (input.sessionId) {
      const existing = this.registry.get(input.sessionId)
      if (existing?.isAlive()) {
        return { sessionId: existing.sessionId, cwd: existing.inner.sessionManager.getCwd() }
      }
      const inflight = this.startLocks.get(input.sessionId)
      if (inflight) {
        const started = await inflight
        return {
          sessionId: started.realSessionId,
          cwd: started.session.inner.sessionManager.getCwd()
        }
      }
      const filePath = await this.sessions.resolvePath(input.sessionId)
      if (!filePath) throw new AgentError(`Session not found: ${input.sessionId}`)
      sessionManager = sdk.SessionManager.open(filePath)
      lockKey = input.sessionId
    } else {
      if (!input.cwd) throw new AgentError('cwd is required for a new session')
      sessionManager = sdk.SessionManager.create(input.cwd)
      lockKey = `new:${randomUUID()}`
    }

    const inflight = this.startLocks.get(lockKey)
    if (inflight) {
      const started = await inflight
      return {
        sessionId: started.realSessionId,
        cwd: started.session.inner.sessionManager.getCwd()
      }
    }

    const starting = this.construct(sdk, sessionManager, input, lockKey)
    this.startLocks.set(lockKey, starting)
    try {
      const started = await starting
      if (input.message?.trim()) {
        try {
          await started.session.send({ type: 'prompt', message: input.message })
        } catch (error) {
          await started.session.shutdown()
          throw error
        }
      }
      return {
        sessionId: started.realSessionId,
        cwd: started.session.inner.sessionManager.getCwd()
      }
    } finally {
      this.startLocks.delete(lockKey)
    }
  }

  async prompt(
    sessionId: string,
    message: string,
    extras: { images?: unknown; streamingBehavior?: 'steer' | 'followUp' } = {}
  ): Promise<unknown> {
    const wrapper = await this.require(sessionId)
    return wrapper.send({
      type:
        extras.streamingBehavior === 'steer'
          ? 'steer'
          : extras.streamingBehavior === 'followUp'
            ? 'follow_up'
            : 'prompt',
      message,
      images: extras.images,
      streamingBehavior: extras.streamingBehavior
    })
  }

  async abort(sessionId: string): Promise<void> {
    const wrapper = this.registry.get(sessionId)
    if (!wrapper) return
    await wrapper.send({ type: 'abort' })
  }

  async stop(sessionId: string): Promise<void> {
    await this.registry.get(sessionId)?.shutdown()
  }

  async command(sessionId: string, command: Record<string, unknown>): Promise<unknown> {
    const wrapper = await this.require(sessionId)
    const result = await wrapper.send(command)
    if (
      command.type === 'fork' &&
      result &&
      typeof result === 'object' &&
      'newSessionId' in result
    ) {
      const payload = result as { newSessionId?: string; newSessionFile?: string }
      if (payload.newSessionId && payload.newSessionFile) {
        this.sessions.cachePath(payload.newSessionId, payload.newSessionFile)
      }
      this.sessions.invalidate()
    }
    if (
      command.type === 'set_session_name' ||
      command.type === 'compact' ||
      command.type === 'append_external_image_result'
    ) {
      this.sessions.invalidate()
    }
    return result
  }

  async getTools(sessionId: string): Promise<ToolEntry[]> {
    const wrapper = await this.require(sessionId)
    return (await wrapper.send({ type: 'get_tools' })) as ToolEntry[]
  }

  defaultToolNames(): string[] {
    return getToolNamesForPreset('default')
  }

  async shutdownAll(): Promise<void> {
    await Promise.all([...this.registry.values()].map((w) => w.shutdown()))
  }

  private async require(sessionId: string): Promise<AgentSessionWrapper> {
    const existing = this.registry.get(sessionId)
    if (existing?.isAlive()) return existing
    await this.start({ sessionId })
    const wrapper = this.registry.get(sessionId)
    if (!wrapper) throw new AgentError(`Failed to start session ${sessionId}`)
    return wrapper
  }

  private async construct(
    sdk: Awaited<ReturnType<typeof loadPiCodingAgent>>,
    sessionManager: PiSessionManagerLike,
    input: StartAgentSessionInput,
    lockKey: string
  ): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
    sdk.initTheme?.()
    const sessionCwd = sessionManager.getCwd()
    if (!sdk.createAgentSessionServices || !sdk.createAgentSessionFromServices) {
      throw new AgentError('Pi SDK createAgentSessionFromServices is unavailable')
    }
    const agentDir = sdk.getAgentDir?.() ?? ''
    const settingsManager = sdk.SettingsManager?.create(sessionCwd, agentDir)
    const systemPromptController: SystemPromptController = {
      forceEmpty: input.toolNames?.length === 0,
      workspacePromptProvider: () =>
        this.workspace?.getPrompt?.(sessionManager.getSessionId()) ?? null,
      appliedSignature: '',
      refresh: async () => undefined
    }
    const services = await sdk.createAgentSessionServices({
      cwd: sessionCwd,
      agentDir,
      ...(settingsManager ? { settingsManager } : {}),
      resourceLoaderOptions: {
        appendSystemPromptOverride: (base: string[]) => {
          if (systemPromptController.forceEmpty) return []
          const merged = applyWorkspacePrompt(
            base.join('\n\n'),
            systemPromptController.workspacePromptProvider?.() ?? null
          )
          return merged ? [merged] : []
        }
      }
    })
    systemPromptController.appliedSignature = systemPromptSignature(systemPromptController)

    const toolNames = input.toolNames
    const toolsOption =
      toolNames !== undefined ? (toolNames.length === 0 ? [] : undefined) : undefined

    let model: unknown
    if (input.provider && input.modelId) {
      const runtime = (services as { modelRuntime?: AgentSessionLike['modelRuntime'] }).modelRuntime
      model = runtime?.getModel(input.provider, input.modelId)
    }

    const { session: inner } = await sdk.createAgentSessionFromServices({
      services,
      sessionManager,
      ...(model ? { model } : {}),
      ...(input.thinkingLevel
        ? { thinkingLevel: resolveModelThinkingLevel(input.thinkingLevel, model) }
        : {}),
      ...(toolsOption !== undefined ? { tools: toolsOption } : {})
    })

    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(withExtensionTools(inner, toolNames))
    }

    const realSessionId = inner.sessionId
    const resourceLoader = (services as { resourceLoader?: AgentSessionLike['resourceLoader'] })
      .resourceLoader
    systemPromptController.refresh = async () => {
      await resourceLoader?.reload?.()
      inner.setActiveToolsByName(inner.getActiveToolNames())
    }
    const wrapper = new AgentSessionWrapper(inner, systemPromptController)
    if (toolNames?.length === 0) wrapper.setForceEmptySystemPrompt(true)
    wrapper.setWorkspacePromptProvider(() => this.workspace?.getPrompt?.(realSessionId) ?? null)
    if (this.workspace?.assertWritable) {
      wrapWorkspaceWriteTools(inner, (target) =>
        this.workspace!.assertWritable!(target, realSessionId)
      )
    }
    this.workspace?.wrapSessionTools?.(inner, realSessionId)
    wrapper.start()

    const realSessionFile = inner.sessionFile
    if (realSessionFile && input.sessionId) this.sessions.cachePath(realSessionId, realSessionFile)

    wrapper.onDestroy(() => {
      this.registry.delete(realSessionId)
      this.broadcastRunning()
    })
    wrapper.onEvent((event) => {
      if (event.type === 'agent_end') this.sessions.invalidate()
      for (const listener of this.sessionListeners.get(realSessionId) ?? []) {
        try {
          listener(event)
        } catch (error) {
          log.agent.error('failed to deliver runtime session event:', error)
        }
      }
      this.broadcastEvent(realSessionId, event)
      if (isRunningStateEvent(event.type)) this.broadcastRunning()
    })
    this.registry.set(realSessionId, wrapper)
    if (typeof inner.bindExtensions === 'function') {
      void inner.bindExtensions({ mode: 'rpc' }).catch((error) => {
        log.agent.warn('bindExtensions failed:', error)
      })
    }
    this.broadcastRunning()
    void lockKey
    return { session: wrapper, realSessionId }
  }

  private broadcastEvent(sessionId: string, event: AgentEvent): void {
    this.eventBatcher.push({ sessionId, event })
  }

  private readonly eventBatcher = new AgentEventBatcher((batch: AgentEventBatch) => {
    const win = this.getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    try {
      win.webContents.send(IPC_EVENT.agentEvent, batch)
    } catch (error) {
      log.agent.error('failed to send agent event:', error)
    }
  })

  private broadcastRunning(): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    try {
      win.webContents.send(IPC_EVENT.agentRunning, { ids: this.listRunning() })
    } catch (error) {
      log.agent.error('failed to send running ids:', error)
    }
  }
}
