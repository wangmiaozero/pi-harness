/**
 * AgentSession registry + runtime. Runs exclusively in Electron Main.
 *
 * Native AgentSessionRuntime owns session replacement and its extension hooks.
 * Host observers detach before Pi disposes the outgoing session.
 */

import { randomUUID } from 'node:crypto'
import type {
  AgentSessionServices,
  SessionStartEvent,
  ToolDefinition
} from '@earendil-works/pi-coding-agent'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
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
  type PiModelLike,
  type PiSessionManagerLike
} from './pi-sdk'
import { AgentEventBatcher, type AgentEventBatch } from './agent-event-batcher'
import { inspectRuntimeError } from '@shared/workspace/runtime-error'
import { applyWorkspacePrompt } from '@shared/workspace/workspace-context'
import {
  isKnownHarnessThinkingLevel,
  resolveCompactionThinkingLevel,
  resolveThinkingLevel
} from '@shared/thinking/levels'
import { createDesktopExtension, type DesktopSessionContext } from './desktop-extension'
import { getIsDev } from '../services/app-paths'
import type { SessionService } from '../sessions/session-service'
import type { AgentRuntime, AgentPromptOptions } from './runtime'

const IDLE_MS = 10 * 60 * 1000
const CODING_TOOL_NAMES = ['read', 'bash', 'powershell', 'edit', 'write', 'grep', 'find', 'ls']
/** Minimum spacing between accumulated-message snapshots relayed on message_update. */
const SNAPSHOT_WIRE_MIN_INTERVAL_MS = 200
const FILE_TOOL_ENFORCEMENT_REQUEST_LIMIT = 4

const EXPLICIT_FILE_MUTATION_REQUESTS = [
  /(?:当前|本|这个|指定).{0,8}目录.{0,48}(?:写|生成|创建|新建|保存|修改|编辑)/s,
  /(?:写入|生成|创建|新建|保存|修改|编辑).{0,80}(?:文件|页面|代码|\.(?:html?|css|js|jsx|ts|tsx|vue|json|md|py|go|java)\b)/is,
  /\b(?:create|write|save|modify|update|edit)\b.{0,80}\b(?:file|page|code|html|css|javascript|typescript|vue|json|markdown|python|golang|java)\b/is
]

type EventListener = (event: AgentEvent) => void
type SessionEventListener = (event: AgentEvent) => void

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
  private workspacePrompt = ''
  private abortRevision = 0
  private fileToolEnforcement: { remainingRequests: number } | null = null
  private _alive = true

  constructor(
    public inner: AgentSessionLike,
    private readonly systemPromptController?: DesktopSessionContext,
    private readonly forkSession?: (
      entryId: string
    ) => Promise<{ cancelled: boolean; newSessionId?: string; newSessionFile?: string }>
  ) {
    installCompactionThinkingGuard(inner)
    this.installFileToolEnforcement()
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
        if (event.type === 'agent_start') this.promptErrorMessage = null
        if (event.type === 'message_end') {
          this.promptErrorMessage = assistantErrorMessage(event.message)
        }
        if (event.type === 'tool_execution_end') {
          const completed = event as { toolName?: string; isError?: boolean }
          if (
            (completed.toolName === 'write' || completed.toolName === 'edit') &&
            completed.isError !== true
          ) {
            this.fileToolEnforcement = null
          }
        }
        if (event.type === 'agent_settled') {
          this.fileToolEnforcement = null
          // Settlement precedes prompt() resolution. Report a final provider
          // error first so Harness cannot mark the run successful on idle.
          if (!event.aborted && this.promptErrorMessage) {
            this.emit({ type: 'prompt_error', errorMessage: this.promptErrorMessage })
          }
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
    if (this.systemPromptController) this.systemPromptController.forceEmpty = force
  }

  setWorkspacePrompt(prompt: string | null): void {
    this.workspacePrompt = prompt ?? ''
    if (this.systemPromptController) {
      this.systemPromptController.workspacePromptProvider = () => this.workspacePrompt || null
    }
  }

  setWorkspacePromptProvider(provider: (() => string | null) | null): void {
    if (this.systemPromptController) this.systemPromptController.workspacePromptProvider = provider
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer()
    const type = command.type as string
    switch (type) {
      case 'prompt': {
        const revision = this.abortRevision
        const imageError = validateAgentImages(command.images)
        if (imageError) throw new AgentError(imageError)
        const release = await this.acquirePromptAdmission()
        try {
          this.assertPromptActive(revision)
          if (this.inner.isBashRunning) {
            throw new AgentError('Cannot send a prompt while a shell command is running')
          }
          const images = await this.prepareImages(command.images)
          this.assertPromptActive(revision)
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
          this.prepareFileToolEnforcement(
            typeof command.toolEnforcementText === 'string'
              ? command.toolEnforcementText
              : String(command.message ?? '')
          )
          const streamingBehavior = command.streamingBehavior as 'steer' | 'followUp' | undefined
          let prompt: Promise<void>
          try {
            prompt = this.inner.prompt(String(command.message ?? ''), {
              ...(images?.length ? { images } : {}),
              ...(streamingBehavior ? { streamingBehavior } : {}),
              source: 'rpc',
              preflightResult: () => acceptPreflight()
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
        this.abortRevision++
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
        if (!this.inner.sessionManager.isPersisted()) return { cancelled: true }
        if (!this.forkSession) throw new AgentError('Native session lifecycle is not bound')
        return this.forkSession(String(command.entryId ?? ''))
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
        if (!supportsThinkingLevel(this.inner, level)) return null
        this.inner.setThinkingLevel(level)
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
        this.inner.abortCompaction()
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
        return null
      }
      case 'append_external_image_result':
        return this.appendExternalImageResult(command)
      case 'steer':
        {
          const imageError = validateAgentImages(command.images)
          if (imageError) throw new AgentError(imageError)
        }
        await this.inner.steer(
          String(command.message ?? ''),
          await this.prepareImages(command.images)
        )
        return null
      case 'follow_up':
        {
          const imageError = validateAgentImages(command.images)
          if (imageError) throw new AgentError(imageError)
        }
        await this.inner.followUp(
          String(command.message ?? ''),
          await this.prepareImages(command.images)
        )
        return null
      case 'get_session_stats':
        return {
          ...this.inner.getSessionStats(),
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
    const contextUsage = this.inner.getContextUsage() ?? null
    const steeringMessages = this.inner.getSteeringMessages()
    const followUpMessages = this.inner.getFollowUpMessages()
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
      thinkingLevel: this.inner.thinkingLevel,
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
    this.detach()
    this.inner.dispose()
  }

  /** Native Pi owns disposal during session replacement; only detach host observers here. */
  detach(): void {
    if (!this._alive) return
    this._alive = false
    this.abortRevision++
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.inner.isBashRunning) this.inner.abortBash()
    this.unsubscribe?.()
    this.onDestroyCallback?.()
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    if (!this._alive) return
    this.shutdownPromise = (async () => {
      this.abortRevision++
      try {
        await this.inner.abort()
        await this.inner.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
      } finally {
        this.destroy()
      }
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

  private assertPromptActive(revision: number): void {
    if (!this._alive || revision !== this.abortRevision) {
      throw new AgentError(
        'Prompt cancelled before execution',
        { kind: 'aborted' },
        { recoverable: true }
      )
    }
  }

  private async prepareImages(value: unknown): Promise<AgentImageAttachment[] | undefined> {
    const images = value as AgentImageAttachment[] | undefined
    if (!images?.length) return undefined
    if (this.inner.settingsManager.getBlockImages()) {
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

  private installFileToolEnforcement(): void {
    const previous = this.inner.agent.onPayload
    this.inner.agent.onPayload = async (payload, model) => {
      const transformed = (await previous?.(payload, model)) ?? payload
      const activeModel = model ?? this.inner.model
      if (thinkingRejectsForcedToolChoice(transformed, activeModel)) {
        const record = transformed as Record<string, unknown>
        if (
          record.tool_choice === 'required' ||
          (record.tool_choice && typeof record.tool_choice === 'object')
        ) {
          const compatible = { ...record }
          delete compatible.tool_choice
          return compatible
        }
        return transformed
      }
      const enforcement = this.fileToolEnforcement
      if (!enforcement || enforcement.remainingRequests <= 0) return transformed
      const required = requireToolChoice(transformed, model?.api ?? this.inner.model?.api)
      if (required === transformed) return transformed
      enforcement.remainingRequests -= 1
      return required
    }
  }

  private prepareFileToolEnforcement(message: string): void {
    const activeTools = new Set(this.inner.getActiveToolNames())
    this.fileToolEnforcement =
      activeTools.has('write') &&
      activeTools.has('edit') &&
      EXPLICIT_FILE_MUTATION_REQUESTS.some((pattern) => pattern.test(message))
        ? { remainingRequests: FILE_TOOL_ENFORCEMENT_REQUEST_LIMIT }
        : null
  }

  private appendExternalImageResult(command: Record<string, unknown>): {
    userEntryId: string
    assistantEntryId: string
  } {
    const result = persistExternalImageResult(this.inner.sessionManager, command)
    this.inner.refreshContext()
    return result
  }
}

export function persistExternalImageResult(
  manager: PiSessionManagerLike,
  command: Record<string, unknown>
): { userEntryId: string; assistantEntryId: string } {
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
  return { userEntryId, assistantEntryId }
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
  // Preserve Pi's exposure decisions; registered tools can intentionally be inactive.
  const extensionToolNames = session.getActiveToolNames().filter((name) => !coding.has(name))
  return [...new Set([...toolNames, ...extensionToolNames])]
}

function supportsThinkingLevel(session: AgentSessionLike, level: ThinkingLevel): boolean {
  return session.getAvailableThinkingLevels().includes(level)
}

function resolveSessionThinkingLevel(session: AgentSessionLike, requested: string): ThinkingLevel {
  const resolved = resolveThinkingLevel({
    requested,
    supportedLevels: session.getAvailableThinkingLevels()
  })
  logThinking('Thinking', requested, resolved, session)
  return resolved
}

function resolveModelThinkingLevel(requested: string, model: unknown): ThinkingLevel {
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
    const current = session.thinkingLevel
    const compactionRequested = resolveCompactionThinkingLevel(current)
    const next = resolveThinkingLevel({
      requested: compactionRequested,
      supportedLevels: session.getAvailableThinkingLevels()
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
  private closing = false
  private shutdownPromise: Promise<void> | null = null

  constructor(
    private readonly sessions: SessionService,
    private readonly workspace?: {
      getPrompt?: (sessionId: string) => string | null
      assertWritable?: (target: string, sessionId: string) => Promise<string>
      /** Policy guard runs after workspace authorization in the public tool pipeline. */
      assertToolAllowed?: (
        toolName: string,
        input: unknown,
        sessionId: string,
        signal?: AbortSignal
      ) => Promise<void>
      customTools?: (cwd: string, sessionId: string) => Promise<ToolDefinition[]>
      architectureHint?: (cwd: string) => Promise<string | null>
      prepareSession?: (sessionId: string, cwd: string) => Promise<void>
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
    this.assertOpen()
    const sdk = await loadPiCodingAgent()
    this.assertOpen()
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

    this.assertOpen()
    const starting = this.construct(sdk, sessionManager, input, lockKey)
    this.startLocks.set(lockKey, starting)
    try {
      const started = await starting
      if (this.closing) {
        await started.session.shutdown()
        this.assertOpen()
      }
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
    extras: AgentPromptOptions = {}
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
      streamingBehavior: extras.streamingBehavior,
      toolEnforcementText: extras.toolEnforcementText
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
    if (this.shutdownPromise) return this.shutdownPromise
    this.closing = true
    this.shutdownPromise = (async () => {
      const stopping = Promise.allSettled(
        [...this.registry.values()].map((wrapper) => wrapper.shutdown())
      )
      const starting = await Promise.allSettled([...this.startLocks.values()])
      const shutdowns: Promise<void>[] = []
      for (const result of starting) {
        if (result.status === 'fulfilled') shutdowns.push(result.value.session.shutdown())
      }
      const results = [...(await stopping), ...(await Promise.allSettled(shutdowns))]
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })()
    return this.shutdownPromise
  }

  private assertOpen(): void {
    if (this.closing) throw new AgentError('Agent runtime is shutting down')
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
    lockKey: string,
    sessionStartEvent?: SessionStartEvent
  ): Promise<{
    session: AgentSessionWrapper
    realSessionId: string
    services: AgentSessionServices
  }> {
    this.assertOpen()
    sdk.initTheme()
    const sessionCwd = sessionManager.getCwd()
    await this.workspace?.prepareSession?.(sessionManager.getSessionId(), sessionCwd)
    const agentDir = sdk.getAgentDir()
    const settingsManager = sdk.SettingsManager.create(sessionCwd, agentDir)
    const architectureHint = (await this.workspace?.architectureHint?.(sessionCwd)) ?? null
    const systemPromptController: DesktopSessionContext = {
      forceEmpty: input.toolNames?.length === 0,
      workspacePromptProvider: () =>
        this.workspace?.getPrompt?.(sessionManager.getSessionId()) ?? null
    }
    const services = await sdk.createAgentSessionServices({
      cwd: sessionCwd,
      agentDir,
      ...(settingsManager ? { settingsManager } : {}),
      resourceLoaderOptions: {
        extensionFactories: [
          {
            name: 'codemode',
            factory: sdk.createCodemodeExtension(),
            builtin: true,
            replaceable: true
          },
          {
            name: 'tool-search',
            factory: sdk.createToolSearchExtension(),
            builtin: true,
            replaceable: true
          },
          { name: 'mcp', factory: sdk.createMcpExtension(), builtin: true, replaceable: true },
          {
            name: 'pi-harness-desktop',
            factory: createDesktopExtension(systemPromptController, {
              assertWritable: this.workspace?.assertWritable
                ? (target) => this.workspace!.assertWritable!(target, sessionManager.getSessionId())
                : undefined,
              assertToolAllowed: this.workspace?.assertToolAllowed
                ? (name, args, signal) =>
                    this.workspace!.assertToolAllowed!(
                      name,
                      args,
                      sessionManager.getSessionId(),
                      signal
                    )
                : undefined
            })
          }
        ],
        appendSystemPromptOverride: (base: string[]) => {
          if (systemPromptController.forceEmpty) return []
          const merged = applyWorkspacePrompt(
            base.join('\n\n'),
            systemPromptController.workspacePromptProvider?.() ?? null
          )
          return [merged, architectureHint].filter((text): text is string => Boolean(text))
        }
      }
    })

    const toolNames = input.toolNames
    const toolsOption =
      toolNames !== undefined ? (toolNames.length === 0 ? [] : undefined) : undefined

    let model: PiModelLike | undefined
    if (input.provider && input.modelId) {
      model = services.modelRuntime.getModel(input.provider, input.modelId)
    }

    const { session: inner } = await sdk.createAgentSessionFromServices({
      services,
      sessionManager,
      ...(sessionStartEvent ? { sessionStartEvent } : {}),
      ...(this.workspace?.customTools && toolNames?.length !== 0
        ? {
            customTools: await this.workspace.customTools(sessionCwd, sessionManager.getSessionId())
          }
        : {}),
      ...(model ? { model } : {}),
      ...(input.thinkingLevel
        ? { thinkingLevel: resolveModelThinkingLevel(input.thinkingLevel, model) }
        : {}),
      ...(toolsOption !== undefined ? { tools: toolsOption } : {})
    })

    const nativeRuntime = new sdk.AgentSessionRuntime(inner, services, async (target) => {
      const next = await this.construct(
        sdk,
        target.sessionManager,
        {
          ...input,
          cwd: target.cwd,
          sessionId: undefined,
          message: undefined,
          provider: inner.model?.provider,
          modelId: inner.model?.id,
          thinkingLevel: inner.thinkingLevel,
          toolNames: inner.getActiveToolNames()
        },
        lockKey,
        target.sessionStartEvent
      )
      return {
        session: next.session.inner,
        services: next.services,
        diagnostics: next.services.diagnostics,
        extensionsResult: next.session.inner.resourceLoader.getExtensions()
      }
    })
    const realSessionId = inner.sessionId
    const wrapper = new AgentSessionWrapper(inner, systemPromptController, async (entryId) => {
      const result = await nativeRuntime.fork(entryId)
      return {
        cancelled: result.cancelled,
        ...(result.cancelled
          ? {}
          : {
              newSessionId: nativeRuntime.session.sessionId,
              newSessionFile: nativeRuntime.session.sessionFile
            })
      }
    })
    nativeRuntime.setBeforeSessionInvalidate(() => wrapper.detach())
    if (toolNames?.length === 0) wrapper.setForceEmptySystemPrompt(true)
    wrapper.setWorkspacePromptProvider(() => this.workspace?.getPrompt?.(realSessionId) ?? null)
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
    try {
      this.assertOpen()
      await inner.bindExtensions({
        mode: 'rpc',
        onError: (error) => log.agent.error('Pi extension error:', error),
        commandContextActions: {
          waitForIdle: () => inner.waitForIdle(),
          newSession: (options) => nativeRuntime.newSession(options),
          fork: (entryId, options) => nativeRuntime.fork(entryId, options),
          switchSession: (file, options) => nativeRuntime.switchSession(file, options),
          navigateTree: (targetId, options) => inner.navigateTree(targetId, options),
          reload: () => inner.reload()
        }
      })
      if (toolNames && toolNames.length > 0) {
        inner.setActiveToolsByName(withExtensionTools(inner, toolNames))
      }
    } catch (error) {
      await wrapper.shutdown()
      throw error
    }
    this.broadcastRunning()
    void lockKey
    return { session: wrapper, realSessionId, services }
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

function thinkingRejectsForcedToolChoice(
  payload: unknown,
  model: PiModelLike | null | undefined
): boolean {
  if (model?.api !== 'openai-completions' || !payload || typeof payload !== 'object') return false
  let deepseekFormat =
    model.compat && 'thinkingFormat' in model.compat && model.compat.thinkingFormat === 'deepseek'
  if (!deepseekFormat && model.baseUrl) {
    try {
      deepseekFormat = new URL(model.baseUrl).hostname.toLowerCase() === 'api.deepseek.com'
    } catch {
      /* Non-URL endpoints retain their declared compatibility. */
    }
  }
  if (!deepseekFormat) return false
  const record = payload as Record<string, unknown>
  const thinking = record.thinking as { type?: unknown } | null | undefined
  // DeepSeek defaults to enabled even when an older custom model omits the thinking field.
  return thinking?.type !== 'disabled' && record.reasoning_effort !== 'none'
}

function requireToolChoice(payload: unknown, api: string | undefined): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const record = payload as Record<string, unknown>
  if (
    api === 'openai-completions' ||
    api === 'openai-responses' ||
    api === 'azure-openai-responses' ||
    api === 'openai-codex-responses'
  ) {
    return Array.isArray(record.tools) && record.tools.length
      ? { ...record, tool_choice: 'required' }
      : payload
  }
  if (api === 'anthropic-messages') {
    return Array.isArray(record.tools) && record.tools.length
      ? { ...record, tool_choice: { type: 'any' } }
      : payload
  }
  if (api === 'google-generative-ai' || api === 'google-vertex') {
    const config = record.config
    if (!config || typeof config !== 'object') return payload
    const configRecord = config as Record<string, unknown>
    if (!Array.isArray(configRecord.tools) || !configRecord.tools.length) return payload
    return {
      ...record,
      config: {
        ...configRecord,
        toolConfig: { functionCallingConfig: { mode: 'ANY' } }
      }
    }
  }
  return payload
}
