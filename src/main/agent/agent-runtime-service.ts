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
  AgentRuntimeStatus,
  AgentStateSnapshot,
  StartAgentSessionInput,
  ToolEntry
} from '@shared/types/workspace'
import {
  isIdleResetEvent,
  isRunningStateEvent,
  toClientAgentEvent
} from '@shared/workspace/agent-event-wire'
import { getToolNamesForPreset } from '@shared/workspace/tool-presets'
import { validateAgentImages } from '@shared/workspace/image-attachments'
import { loadPiCodingAgent, type AgentSessionLike, type PiSessionManagerLike } from './pi-sdk'
import type { SessionService } from '../sessions/session-service'

const IDLE_MS = 10 * 60 * 1000
const CODING_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']

type EventListener = (event: AgentEvent) => void

export class AgentSessionWrapper {
  private listeners: EventListener[] = []
  private unsubscribe: (() => void) | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private onDestroyCallback: (() => void) | null = null
  private shutdownPromise: Promise<void> | null = null
  private pendingPromptCount = 0
  private promptAdmissionTail: Promise<void> = Promise.resolve()
  private forceEmptySystemPrompt = false
  private _alive = true

  constructor(public inner: AgentSessionLike) {}

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
      if (event.type === 'agent_end') {
        /* session list refresh is triggered by the runtime service */
      }
      if (isIdleResetEvent(event.type)) this.resetIdleTimer()
      this.emit(event as AgentEvent)
    })
    this.resetIdleTimer()
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
        if (imageError) throw new AgentError(imageError)
        const release = await this.acquirePromptAdmission()
        try {
          if (this.inner.isBashRunning) {
            throw new AgentError('Cannot send a prompt while a shell command is running')
          }
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
          const images = command.images as
            Array<{ type: 'image'; data: string; mimeType: string }> | undefined
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
              if (!streamingBehavior) this.emit({ type: 'prompt_done' })
            },
            (error) => {
              rejectPreflight(error)
              finishPrompt()
              if (preflightAccepted) {
                this.emit({
                  type: 'prompt_error',
                  errorMessage: error instanceof Error ? error.message : String(error)
                })
                if (!streamingBehavior) this.emit({ type: 'prompt_done' })
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
        let model = this.inner.modelRuntime.getModel(provider, modelId)
        if (!model) {
          await this.inner.modelRuntime.refresh({ allowNetwork: false })
          model = this.inner.modelRuntime.getModel(provider, modelId)
        }
        if (!model) throw new AgentError(`Model not found: ${provider}/${modelId}`)
        await this.inner.setModel(model)
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
        const level = String(command.level ?? 'off')
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
          throw error
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
        this.inner.setActiveToolsByName(withExtensionTools(this.inner, toolNames))
        this.applyForcedEmptySystemPrompt()
        return null
      }
      case 'steer':
        {
          const imageError = validateAgentImages(command.images)
          if (imageError) throw new AgentError(imageError)
        }
        await this.inner.steer?.(String(command.message ?? ''), command.images)
        return null
      case 'follow_up':
        {
          const imageError = validateAgentImages(command.images)
          if (imageError) throw new AgentError(imageError)
        }
        await this.inner.followUp?.(String(command.message ?? ''), command.images)
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
    const contextUsage = this.inner.getContextUsage()
    return {
      sessionId: this.inner.sessionId,
      sessionFile: this.inner.sessionFile ?? '',
      status: this.status(),
      isStreaming: this.inner.isStreaming,
      isPromptRunning: this.pendingPromptCount > 0,
      isBashRunning: this.inner.isBashRunning,
      isCompacting: this.inner.isCompacting,
      autoCompactionEnabled: this.inner.autoCompactionEnabled,
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
        steering: [...(this.inner.getSteeringMessages?.() ?? [])],
        followUp: [...(this.inner.getFollowUpMessages?.() ?? [])]
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
    const client = toClientAgentEvent(event)
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
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = ''
    }
  }
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

export class AgentRuntimeService {
  private registry = new Map<string, AgentSessionWrapper>()
  private startLocks = new Map<
    string,
    Promise<{ session: AgentSessionWrapper; realSessionId: string }>
  >()
  private getWindow: () => BrowserWindow | null = () => null

  constructor(private readonly sessions: SessionService) {}

  attachWindow(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow
  }

  listRunning(): string[] {
    return [...this.registry.values()].filter((w) => w.isRunning()).map((w) => w.sessionId)
  }

  get(sessionId: string): AgentSessionWrapper | undefined {
    return this.registry.get(sessionId)
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
    if (command.type === 'set_session_name' || command.type === 'compact') {
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
    const services = await sdk.createAgentSessionServices({
      cwd: sessionCwd,
      agentDir,
      ...(settingsManager ? { settingsManager } : {})
    })

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
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
      ...(toolsOption !== undefined ? { tools: toolsOption } : {})
    })

    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(withExtensionTools(inner, toolNames))
    }

    const wrapper = new AgentSessionWrapper(inner)
    if (toolNames?.length === 0) wrapper.setForceEmptySystemPrompt(true)
    wrapper.start()

    const realSessionId = inner.sessionId
    const realSessionFile = inner.sessionFile
    if (realSessionFile && input.sessionId) this.sessions.cachePath(realSessionId, realSessionFile)

    wrapper.onDestroy(() => {
      this.registry.delete(realSessionId)
      this.broadcastRunning()
    })
    wrapper.onEvent((event) => {
      if (event.type === 'agent_end') this.sessions.invalidate()
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
    this.getWindow()?.webContents.send(IPC_EVENT.agentEvent, { sessionId, event })
  }

  private broadcastRunning(): void {
    this.getWindow()?.webContents.send(IPC_EVENT.agentRunning, { ids: this.listRunning() })
  }
}
