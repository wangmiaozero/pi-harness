/**
 * AgentSessionWrapper (runtime port of `src/main/agent/agent-runtime-service.ts`).
 *
 * Wraps one live Pi SDK AgentSession:
 * - subscribes to SDK events and relays them (post wire-mapping) to listeners
 * - serializes prompt admission (preflight gate) and tracks pending prompts
 * - implements the `agent.command` vocabulary (prompt/abort/fork/compact/…)
 * - idles out of memory after IDLE_MS
 *
 * Differences from Electron: no workspace prompt / write-tool guard (workspace
 * domain arrives in a later phase); diagnostics go to the injected log sink.
 */

import type {
  AgentEvent,
  AgentImageAttachment,
  AgentRuntimeStatus,
  AgentStateSnapshot
} from '../types.js'
import {
  hasAssistantSnapshot,
  isIdleResetEvent,
  toIpcAgentEvent
} from '../support/agent-event-wire.js'
import { validateAgentImages } from '../support/image-attachments.js'
import { resolveModelInput } from '../support/provider-presets.js'
import {
  getSupportedThinkingLevels,
  resolveCompactionThinkingLevel,
  resolveThinkingLevel
} from '../support/thinking.js'
import { inspectRuntimeError } from '../support/runtime-error.js'
import { RuntimeError } from '../pi/errors.js'
import type { AgentSessionLike, PiSdkLoader } from '../pi/types.js'
import type { LogFn } from '../session/service.js'

const IDLE_MS = 10 * 60 * 1000
const CODING_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']
/** Minimum spacing between accumulated-message snapshots relayed on message_update. */
const SNAPSHOT_WIRE_MIN_INTERVAL_MS = 200

export type EventListener = (event: AgentEvent) => void

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
  private _alive = true

  constructor(
    public inner: AgentSessionLike,
    private readonly log: LogFn = () => {},
    private readonly loadSdk: PiSdkLoader = async () => {
      throw new RuntimeError('PI_SDK_NOT_AVAILABLE', 'No SDK loader configured')
    }
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
        if (isIdleResetEvent(event.type)) this.resetIdleTimer()
        this.emit(this.throttleWireSnapshot(event as AgentEvent))
      } catch (raw) {
        this.log(`failed to handle Pi session event: ${String(raw)}`)
      }
    })
    this.resetIdleTimer()
  }

  /**
   * The SDK attaches the full accumulated message to every streaming delta;
   * relay one snapshot per interval so message_update payloads stay O(delta).
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
    this.applyForcedEmptySystemPrompt()
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer()
    const type = command.type as string
    switch (type) {
      case 'prompt': {
        const imageError = validateAgentImages(command.images)
        if (imageError) throw new RuntimeError('INVALID_INPUT', imageError)
        const release = await this.acquirePromptAdmission()
        try {
          if (this.inner.isBashRunning) {
            throw new RuntimeError(
              'AGENT_BUSY',
              'Cannot send a prompt while a shell command is running'
            )
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
          this.applyForcedEmptySystemPrompt()
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
          } catch (raw) {
            finishPrompt()
            throw raw
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
            (raw) => {
              rejectPreflight(raw)
              finishPrompt()
              if (preflightAccepted) {
                const errorMessage = inspectRuntimeError(raw).userMessage
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
        if (!model)
          throw new RuntimeError('MODEL_NOT_FOUND', `Model not found: ${provider}/${modelId}`)
        const resolvedInput = resolveModelInput({
          providerKey: model.provider,
          modelId: model.id,
          configuredInput: model.input
        })
        await this.inner.setModel({ ...model, input: [...resolvedInput] })
        return { id: model.id, provider: model.provider }
      }
      case 'fork': {
        if (this.inner.isBashRunning) {
          throw new RuntimeError('AGENT_BUSY', 'Cannot fork while a shell command is running')
        }
        const entryId = String(command.entryId ?? '')
        const sessionManager = this.inner.sessionManager
        const currentSessionFile = this.inner.sessionFile
        if (!sessionManager.isPersisted()) return { cancelled: true }
        if (!currentSessionFile) {
          throw new RuntimeError('AGENT_ERROR', 'Persisted session is missing a session file')
        }
        const entry = sessionManager.getEntry(entryId)
        if (!entry) throw new RuntimeError('INVALID_INPUT', 'Invalid entry ID for forking')
        const sessionDir = sessionManager.getSessionDir()
        const sdk = await this.loadSdk()
        let newSessionFile: string
        const typedEntry = entry as { parentId?: string | null }
        if (!typedEntry.parentId) {
          const newManager = sdk.SessionManager.create(sessionManager.getCwd(), sessionDir)
          newManager.newSession({ parentSession: currentSessionFile })
          newSessionFile = newManager.getSessionFile() as string
        } else {
          const sourceManager = sdk.SessionManager.open(currentSessionFile, sessionDir)
          const forkedPath = sourceManager.createBranchedSession(typedEntry.parentId)
          if (!forkedPath) {
            throw new RuntimeError('AGENT_ERROR', 'Failed to create forked session')
          }
          newSessionFile = forkedPath
        }
        const newSessionId = sdk.SessionManager.open(newSessionFile, sessionDir).getSessionId()
        await this.shutdown()
        return { cancelled: false, newSessionId, newSessionFile }
      }
      case 'navigate_tree': {
        if (this.inner.isBashRunning) {
          throw new RuntimeError('AGENT_BUSY', 'Cannot navigate while a shell command is running')
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
        } catch (raw) {
          const message = raw instanceof Error ? raw.message : String(raw)
          if (message === 'Nothing to compact (session too small)') {
            return { cancelled: true, reason: 'session-too-small' }
          }
          if (message === 'Already compacted') {
            return { cancelled: true, reason: 'already-compacted' }
          }
          const runtime = inspectRuntimeError(raw)
          throw new RuntimeError('COMPACTION_FAILED', runtime.userMessage, { recoverable: true })
        }
      case 'abort_compaction':
        this.inner.abortCompaction?.()
        return null
      case 'set_session_name': {
        const name = String(command.name ?? '').trim()
        if (!name) throw new RuntimeError('INVALID_INPUT', 'Session name cannot be empty')
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
        this.applyForcedEmptySystemPrompt()
        return null
      }
      case 'steer':
      case 'follow_up': {
        const imageError = validateAgentImages(command.images)
        if (imageError) throw new RuntimeError('INVALID_INPUT', imageError)
        const images = await this.prepareImages(command.images)
        if (type === 'steer') {
          await this.inner.steer?.(String(command.message ?? ''), images)
        } else {
          await this.inner.followUp?.(String(command.message ?? ''), images)
        }
        return null
      }
      case 'get_session_stats':
        return {
          ...(this.inner.getSessionStats?.() ?? {}),
          sessionName: this.inner.sessionManager.getSessionName()
        }
      case 'set_auto_compaction':
        this.inner.setAutoCompactionEnabled(Boolean(command.enabled))
        return null
      default:
        throw new RuntimeError('INVALID_INPUT', `Unsupported command: ${String(type)}`)
    }
  }

  snapshot(): AgentStateSnapshot {
    const model = this.inner.model
    const contextUsage = safelyRead(() => this.inner.getContextUsage?.() ?? null, null)
    const steeringMessages = safelyRead(
      () =>
        (
          this.inner as unknown as { getSteeringMessages?: () => string[] }
        ).getSteeringMessages?.() ?? [],
      []
    )
    const followUpMessages = safelyRead(
      () =>
        (
          this.inner as unknown as { getFollowUpMessages?: () => string[] }
        ).getFollowUpMessages?.() ?? [],
      []
    )
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
      this.disposeInner()
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

  private disposeInner(): void {
    const maybeDispose = (this.inner as unknown as { dispose?: () => void }).dispose
    if (typeof maybeDispose === 'function') maybeDispose.call(this.inner)
  }

  private emit(event: AgentEvent): void {
    const client = toIpcAgentEvent(event)
    if (!client) return
    for (const listener of this.listeners) {
      try {
        listener(client as AgentEvent)
      } catch (raw) {
        this.log(`failed to deliver agent event: ${String(raw)}`)
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
      throw new RuntimeError('INVALID_INPUT', 'Image input is disabled in Pi settings')
    }

    const currentModel = this.inner.model
    let model = currentModel
    if (!this.inner.isStreaming && model) {
      await this.inner.modelRuntime.refresh({ allowNetwork: false })
      const refreshed = this.inner.modelRuntime.getModel(model.provider, model.id)
      if (!refreshed) {
        throw new RuntimeError('MODEL_NOT_FOUND', `Model not found: ${model.provider}/${model.id}`)
      }
      model = refreshed
    }
    if (!model) throw new RuntimeError('AGENT_ERROR', 'No model selected')

    const effectiveInput = resolveModelInput({
      providerKey: model.provider,
      modelId: model.id,
      configuredInput: model.input
    })
    if (!effectiveInput.includes('image')) {
      throw new RuntimeError(
        'INVALID_INPUT',
        `Model does not support image input: ${model.provider}/${model.id}`
      )
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
      void this.shutdown().catch((raw) => {
        this.log(`idle shutdown failed: ${String(raw)}`)
      })
    }, IDLE_MS)
    if (typeof this.idleTimer.unref === 'function') this.idleTimer.unref()
  }

  private applyForcedEmptySystemPrompt(): void {
    if (!this.inner.agent.state) return
    if (this.forceEmptySystemPrompt) {
      this.inner.agent.state.systemPrompt = ''
    }
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
  return resolveThinkingLevel({
    requested,
    supportedLevels: sessionThinkingSource(session)
  })
}

export function resolveModelThinkingLevel(requested: string, model: unknown): string {
  const map =
    model && typeof model === 'object'
      ? (model as { thinkingLevelMap?: Partial<Record<string, string | null>> }).thinkingLevelMap
      : undefined
  return resolveThinkingLevel({ requested, supportedLevels: map })
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
    try {
      return await original(instructions)
    } finally {
      if (restore && supportsThinkingLevel(session, current)) {
        session.setThinkingLevel(current)
      }
    }
  }
}
