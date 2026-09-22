/**
 * Agent runtime manager (runtime port of `AgentRuntimeService`).
 *
 * Owns the live AgentSession registry, start locks and event fan-out.
 * Event delivery: wrapper events go to (a) per-session listeners (harness
 * service), and (b) the batched `agent.event` envelopes on the runtime
 * event sink. Running-id changes emit `agent.running`.
 */

import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentStateSnapshot, StartAgentSessionInput, ToolEntry } from '../types.js'
import { isRunningStateEvent } from '../support/agent-event-wire.js'
import { getToolNamesForPreset } from '../support/tool-presets.js'
import { RuntimeError } from '../pi/errors.js'
import type { AgentSessionLike, PiSdkLoader } from '../pi/types.js'
import type { SessionService } from '../session/service.js'
import type { LogFn } from '../session/service.js'
import { AgentEventBatcher, type AgentEventBatch } from './events.js'
import { AgentSessionWrapper, resolveModelThinkingLevel } from './wrapper.js'

export type SessionEventListener = (event: AgentEvent) => void

/** Runtime event sink — index.ts wires this to the JSONL stdout writer. */
export interface AgentRuntimeSinks {
  /** Batched `{sessionId, event}` envelopes (or a single envelope). */
  onAgentEvent: (batch: AgentEventBatch) => void
  /** Running session-id set changed. */
  onRunningChange: (ids: string[]) => void
  /** Live AgentSession just created — Control Plane wraps policy-guarded tools. */
  onSessionCreated?: (session: AgentSessionLike, sessionId: string) => void
}

export class AgentRuntimeManager {
  private registry = new Map<string, AgentSessionWrapper>()
  private sessionListeners = new Map<string, Set<SessionEventListener>>()
  private startLocks = new Map<
    string,
    Promise<{ session: AgentSessionWrapper; realSessionId: string }>
  >()
  private readonly eventBatcher: AgentEventBatcher

  constructor(
    private readonly sessions: SessionService,
    private readonly loadSdk: PiSdkLoader,
    private readonly sinks: AgentRuntimeSinks,
    private readonly log: LogFn = () => {}
  ) {
    this.eventBatcher = new AgentEventBatcher((batch) => {
      this.sinks.onAgentEvent(batch)
    })
  }

  diagnostics(): { implementation: 'pi'; sdkLoaded: boolean } {
    return { implementation: 'pi', sdkLoaded: this.sdkLoaded }
  }

  private sdkLoaded = false
  private firstStartAtInternal: number | null = null

  /** Epoch ms of the first successful session start (§36 metric). */
  get firstStartAt(): number | null {
    return this.firstStartAtInternal
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
    const sdk = await this.loadSdk()
    this.sdkLoaded = true
    let sessionManager: ReturnType<typeof sdk.SessionManager.create>
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
      if (!filePath) {
        throw new RuntimeError('SESSION_NOT_FOUND', `Session not found: ${input.sessionId}`)
      }
      sessionManager = sdk.SessionManager.open(filePath)
      lockKey = input.sessionId
    } else {
      if (!input.cwd) {
        throw new RuntimeError('INVALID_INPUT', 'cwd is required for a new session')
      }
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
      if (this.firstStartAtInternal === null) this.firstStartAtInternal = Date.now()
      if (input.message?.trim()) {
        try {
          await started.session.send({ type: 'prompt', message: input.message })
        } catch (raw) {
          await started.session.shutdown()
          throw raw
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
    this.eventBatcher.close()
  }

  private async require(sessionId: string): Promise<AgentSessionWrapper> {
    const existing = this.registry.get(sessionId)
    if (existing?.isAlive()) return existing
    await this.start({ sessionId })
    const wrapper = this.registry.get(sessionId)
    if (!wrapper) {
      throw new RuntimeError('AGENT_NOT_FOUND', `Failed to start session ${sessionId}`)
    }
    return wrapper
  }

  private async construct(
    sdk: Awaited<ReturnType<PiSdkLoader>>,
    sessionManager: ReturnType<typeof sdk.SessionManager.create>,
    input: StartAgentSessionInput,
    lockKey: string
  ): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
    try {
      sdk.initTheme?.()
    } catch {
      /* cosmetic */
    }
    const sessionCwd = sessionManager.getCwd()
    const agentDir = sdk.getAgentDir?.() ?? ''
    const services = await sdk.createAgentSessionServices({
      cwd: sessionCwd,
      agentDir
    })

    const toolNames = input.toolNames
    const toolsOption =
      toolNames !== undefined ? (toolNames.length === 0 ? [] : undefined) : undefined

    let model: unknown
    if (input.provider && input.modelId) {
      const runtime = services.modelRuntime
      model = runtime.getModel(input.provider, input.modelId)
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
    const wrapper = new AgentSessionWrapper(inner, this.log, this.loadSdk)
    if (toolNames?.length === 0) wrapper.setForceEmptySystemPrompt(true)
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
        } catch (raw) {
          this.log(`failed to deliver runtime session event: ${String(raw)}`)
        }
      }
      this.eventBatcher.push({ sessionId: realSessionId, event })
      if (isRunningStateEvent(event.type)) this.broadcastRunning()
    })
    this.registry.set(realSessionId, wrapper)
    this.sinks.onSessionCreated?.(inner, realSessionId)
    const bindExtensions = (
      inner as unknown as {
        bindExtensions?: (bindings: Record<string, unknown>) => Promise<void>
      }
    ).bindExtensions
    if (typeof bindExtensions === 'function') {
      void bindExtensions.call(inner, { mode: 'rpc' }).catch((raw) => {
        this.log(`bindExtensions failed: ${String(raw)}`)
      })
    }
    this.broadcastRunning()
    void lockKey
    return { session: wrapper, realSessionId }
  }

  private broadcastRunning(): void {
    try {
      this.sinks.onRunningChange(this.listRunning())
    } catch (raw) {
      this.log(`failed to broadcast running ids: ${String(raw)}`)
    }
  }
}

function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return []
  const coding = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'])
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !coding.has(name))
  return [...new Set([...toolNames, ...extensionToolNames])]
}
