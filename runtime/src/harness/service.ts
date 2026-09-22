/**
 * Harness service (runtime port of `HarnessRuntime` + `PiHarnessAdapter`).
 *
 * Sits on top of AgentRuntimeManager, presenting the stable desktop Harness
 * DTOs: state, tools, capabilities, model/thinking switching, compaction,
 * steer/follow-up, fork/navigateTree, session info, stats and the per-session
 * event timeline. Every mutating call emits the corresponding HarnessEvent
 * (`tools.changed`, `model.changed`, …) exactly like the Electron main.
 *
 * The run registry / trace / policy / checkpoints layers are NOT part of this
 * phase; they stay Electron-only until the control-plane phase.
 */

import type { AgentEvent, AgentStateSnapshot, StartAgentSessionInput } from '../types.js'
import { RuntimeError } from '../pi/errors.js'
import type { AgentRuntimeManager } from '../agent/manager.js'
import type { AgentSessionWrapper } from '../agent/wrapper.js'
import type { SessionService } from '../session/service.js'
import type { LogFn } from '../session/service.js'
import {
  detectHarnessCapabilities,
  getThinkingOptions,
  mapAgentEvent,
  mapHarnessSession,
  mapHarnessState,
  mapStats,
  mapTools,
  redactSecretText
} from './mappers.js'
import type {
  HarnessCapabilities,
  HarnessCompactionResult,
  HarnessEvent,
  HarnessForkResult,
  HarnessSessionInfo,
  HarnessState,
  HarnessStats,
  HarnessTool
} from './types.js'

const MAX_TIMELINE_EVENTS = 300

export interface HarnessServiceSinks {
  /** Forward a mapped harness event for a session (`harness.event` RPC event). */
  onEvent: (sessionId: string, event: HarnessEvent) => void
}

export class HarnessService {
  /** sessionId -> unobserve callback */
  private observedSessions = new Map<string, () => void>()
  /** sessionId -> recent harness events (oldest first, capped). */
  private timelines = new Map<string, HarnessEvent[]>()

  constructor(
    private readonly agent: AgentRuntimeManager,
    private readonly sessions: SessionService,
    private readonly sinks: HarnessServiceSinks,
    private readonly log: LogFn = () => {}
  ) {}

  diagnostics(): { implementation: 'pi'; sdkLoaded: boolean } {
    return this.agent.diagnostics()
  }

  listRunning(): string[] {
    return this.agent.listRunning()
  }

  // --------------------------------------------------------- agent surface

  async start(input: StartAgentSessionInput): Promise<{ sessionId: string; cwd: string }> {
    const result = await this.agent.start(input)
    this.observe(result.sessionId)
    this.emit(result.sessionId, { type: 'session.started', timestamp: Date.now() })
    return result
  }

  async prompt(
    sessionId: string,
    message: string,
    extras: { images?: unknown; streamingBehavior?: 'steer' | 'followUp' } = {}
  ): Promise<unknown> {
    this.observe(sessionId)
    const queuedType =
      extras.streamingBehavior === 'steer'
        ? 'steering.queued'
        : extras.streamingBehavior === 'followUp'
          ? 'followUp.queued'
          : null
    if (!queuedType) {
      this.emit(sessionId, { type: 'prompt.started', timestamp: Date.now(), message })
    }
    try {
      const result = await this.agent.prompt(sessionId, message, extras)
      if (queuedType) this.emit(sessionId, { type: queuedType, timestamp: Date.now() })
      return result
    } catch (raw) {
      this.emitError(sessionId, raw)
      throw raw
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.agent.abort(sessionId)
    this.emit(sessionId, { type: 'runtime.aborted', timestamp: Date.now() })
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.agent.stop(sessionId)
    this.emit(sessionId, { type: 'session.stopped', timestamp: Date.now() })
  }

  async executeAgentCommand(sessionId: string, command: Record<string, unknown>): Promise<unknown> {
    switch (String(command.type ?? '')) {
      case 'set_model':
        return this.setModel(
          sessionId,
          String(command.provider ?? ''),
          String(command.modelId ?? '')
        )
      case 'set_thinking_level':
        return this.setThinkingLevel(sessionId, String(command.level ?? 'off'))
      case 'get_tools':
        return this.getTools(sessionId)
      case 'set_tools':
        return this.setTools(sessionId, (command.toolNames as string[]) ?? [], {
          preserveExtensionTools: true
        })
      case 'compact':
        return this.compact(sessionId, command.customInstructions as string | undefined)
      case 'abort_compaction':
        return this.abortCompaction(sessionId)
      case 'set_auto_compaction':
        return this.setAutoCompaction(sessionId, Boolean(command.enabled))
      case 'steer':
        return this.steer(sessionId, String(command.message ?? ''), command.images)
      case 'follow_up':
        return this.followUp(sessionId, String(command.message ?? ''), command.images)
      case 'fork':
        return this.fork(sessionId, String(command.entryId ?? ''))
      case 'navigate_tree':
        return this.navigateTree(sessionId, String(command.targetId ?? ''))
      default:
        this.observe(sessionId)
        return this.agent.command(sessionId, command)
    }
  }

  async getAgentState(sessionId: string): Promise<AgentStateSnapshot | null> {
    this.observe(sessionId)
    return this.agent.getState(sessionId)
  }

  // -------------------------------------------------------- harness surface

  async getState(sessionId: string): Promise<HarnessState | null> {
    this.observe(sessionId)
    const snapshot = await this.agent.getState(sessionId)
    if (!snapshot) return null
    const wrapper = this.requireLive(sessionId)
    let capabilities = detectHarnessCapabilities(wrapper.inner)
    let tools: HarnessTool[] = []
    if (capabilities.tools) {
      try {
        tools = mapTools(wrapper.inner)
      } catch {
        capabilities = { ...capabilities, tools: false }
      }
    }
    let stats: HarnessStats | undefined
    if (capabilities.stats) {
      try {
        stats = mapStats(wrapper.inner, snapshot, tools)
      } catch {
        capabilities = { ...capabilities, stats: false }
      }
    }
    return mapHarnessState(snapshot, capabilities, tools, getThinkingOptions(wrapper.inner), stats)
  }

  async getCapabilities(sessionId: string): Promise<HarnessCapabilities> {
    return detectHarnessCapabilities(this.requireLive(sessionId).inner)
  }

  async getTools(sessionId: string): Promise<HarnessTool[]> {
    this.observe(sessionId)
    await this.requireCapability(sessionId, 'tools')
    return this.agent.getTools(sessionId)
  }

  async setTools(
    sessionId: string,
    toolNames: string[],
    options: { preserveExtensionTools?: boolean } = {}
  ): Promise<void> {
    this.observe(sessionId)
    const wrapper = await this.requireCapability(sessionId, 'tools')
    const known = new Set(wrapper.inner.getAllTools().map((tool) => tool.name))
    const missing = toolNames.find((name) => !known.has(name))
    if (missing) {
      throw new RuntimeError('TOOL_NOT_FOUND', `Tool not found: ${missing}`)
    }
    await this.agent.command(sessionId, {
      type: 'set_tools',
      toolNames,
      preserveExtensionTools: options.preserveExtensionTools ?? false
    })
    this.emit(sessionId, {
      type: 'tools.changed',
      timestamp: Date.now(),
      active: (await this.agent.getTools(sessionId)).filter((tool) => tool.active).length
    })
  }

  async setModel(sessionId: string, provider: string, modelId: string): Promise<void> {
    this.observe(sessionId)
    await this.requireCapability(sessionId, 'modelSwitch')
    await this.agent.command(sessionId, { type: 'set_model', provider, modelId })
    this.emit(sessionId, { type: 'model.changed', timestamp: Date.now(), provider, modelId })
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    this.observe(sessionId)
    const wrapper = await this.requireCapability(sessionId, 'thinkingLevel')
    if (typeof wrapper.inner.getAvailableThinkingLevels === 'function') {
      const options = getThinkingOptions(wrapper.inner)
      if (level !== 'auto' && options.length > 1 && !options.includes(level)) return
    }
    await this.agent.command(sessionId, { type: 'set_thinking_level', level })
    this.emit(sessionId, { type: 'thinking.changed', timestamp: Date.now(), level })
  }

  async compact(
    sessionId: string,
    instructions?: string
  ): Promise<HarnessCompactionResult | unknown> {
    this.observe(sessionId)
    await this.requireCapability(sessionId, 'compaction')
    const result = await this.agent.command(sessionId, {
      type: 'compact',
      customInstructions: instructions
    })
    if (isCompactionResult(result) && result.cancelled && result.reason) {
      this.emit(sessionId, {
        type: 'compaction.skipped',
        timestamp: Date.now(),
        reason: result.reason
      })
    }
    return result
  }

  async abortCompaction(sessionId: string): Promise<void> {
    const wrapper = await this.requireCapability(sessionId, 'compaction')
    if (typeof wrapper.inner.abortCompaction !== 'function') {
      throw new RuntimeError('COMPACTION_NOT_AVAILABLE', 'This Pi version cannot abort compaction.')
    }
    await this.agent.command(sessionId, { type: 'abort_compaction' })
    this.emit(sessionId, { type: 'runtime.aborted', timestamp: Date.now() })
  }

  async setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
    await this.requireCapability(sessionId, 'autoCompaction')
    await this.agent.command(sessionId, { type: 'set_auto_compaction', enabled })
    this.emit(sessionId, { type: 'autoCompaction.changed', timestamp: Date.now(), enabled })
  }

  async steer(sessionId: string, message: string, images?: unknown): Promise<void> {
    this.observe(sessionId)
    await this.requireCapability(sessionId, 'steering')
    await this.agent.command(sessionId, { type: 'steer', message, images })
    this.emit(sessionId, { type: 'steering.queued', timestamp: Date.now() })
  }

  async followUp(sessionId: string, message: string, images?: unknown): Promise<void> {
    this.observe(sessionId)
    await this.requireCapability(sessionId, 'followUp')
    await this.agent.command(sessionId, { type: 'follow_up', message, images })
    this.emit(sessionId, { type: 'followUp.queued', timestamp: Date.now() })
  }

  async fork(sessionId: string, entryId: string): Promise<HarnessForkResult> {
    await this.requireCapability(sessionId, 'sessionFork')
    const result = (await this.agent.command(sessionId, {
      type: 'fork',
      entryId
    })) as HarnessForkResult
    if (!result.cancelled && result.newSessionId) {
      this.emit(sessionId, {
        type: 'session.forked',
        timestamp: Date.now(),
        newSessionId: result.newSessionId
      })
    }
    return result
  }

  async navigateTree(sessionId: string, targetId: string): Promise<unknown> {
    await this.requireCapability(sessionId, 'sessionTree')
    const result = await this.agent.command(sessionId, { type: 'navigate_tree', targetId })
    this.emit(sessionId, { type: 'session.navigated', timestamp: Date.now(), targetId })
    return result
  }

  async getStats(sessionId: string): Promise<HarnessStats> {
    const wrapper = await this.requireCapability(sessionId, 'stats')
    const snapshot = wrapper.snapshot()
    return mapStats(wrapper.inner, snapshot, mapTools(wrapper.inner))
  }

  async getSession(sessionId: string): Promise<HarnessSessionInfo> {
    this.observe(sessionId)
    return mapHarnessSession(this.requireLive(sessionId).inner)
  }

  /** Replayable timeline for the Harness console (oldest first). */
  getTimeline(sessionId: string): HarnessEvent[] {
    return [...(this.timelines.get(sessionId) ?? [])]
  }

  defaultToolNames(): string[] {
    return this.agent.defaultToolNames()
  }

  async shutdownAll(): Promise<void> {
    await this.agent.shutdownAll()
    for (const unsubscribe of this.observedSessions.values()) unsubscribe()
    this.observedSessions.clear()
  }

  // ------------------------------------------------------------- internals

  /**
   * Subscribe to a running session's events: map to HarnessEvents, append to
   * the timeline and forward to the sink. Idempotent per session; works for
   * sessions that are not running yet (events flow once the agent starts).
   */
  observe(sessionId: string): void {
    if (this.observedSessions.has(sessionId)) return
    this.observedSessions.set(
      sessionId,
      this.agent.subscribe(sessionId, (event: AgentEvent) => {
        for (const harnessEvent of mapAgentEvent(event)) {
          this.emit(sessionId, harnessEvent)
        }
        if (
          event.type === 'agent_end' ||
          event.type === 'agent_settled' ||
          event.type === 'compaction_end' ||
          event.type === 'auto_compaction_end'
        ) {
          void this.emitContext(sessionId)
        }
      })
    )
    if (!this.timelines.has(sessionId)) this.timelines.set(sessionId, [])
  }

  /** True when the session has been observed at least once. */
  isObserved(sessionId: string): boolean {
    return this.observedSessions.has(sessionId)
  }

  private async emitContext(sessionId: string): Promise<void> {
    try {
      const state = await this.getState(sessionId)
      if (!state?.context) return
      this.emit(sessionId, {
        type: 'context.updated',
        timestamp: Date.now(),
        ...state.context
      })
    } catch {
      /* A stopped session has no live context snapshot. */
    }
  }

  private emitError(sessionId: string, raw: unknown): void {
    this.emit(sessionId, {
      type: 'runtime.error',
      timestamp: Date.now(),
      message: redactSecretText(raw instanceof Error ? raw.message : String(raw))
    })
  }

  /**
   * Public emit used by the Control Plane for derived events (run.*,
   * checkpoint.*, policy.*, orchestration.*). Same delivery path as
   * internal emits so the timeline + JSONL sink stay ordered.
   */
  emitEvent(sessionId: string, event: object): void {
    this.emit(sessionId, event as HarnessEvent)
  }

  private emit(sessionId: string, event: HarnessEvent): void {
    if (!this.observedSessions.has(sessionId)) this.observe(sessionId)
    let timeline = this.timelines.get(sessionId)
    if (!timeline) {
      timeline = []
      this.timelines.set(sessionId, timeline)
    }
    timeline.push(event)
    if (timeline.length > MAX_TIMELINE_EVENTS) {
      timeline.splice(0, timeline.length - MAX_TIMELINE_EVENTS)
    }
    try {
      this.sinks.onEvent(sessionId, event)
    } catch (raw) {
      this.log(`failed to forward harness event: ${String(raw)}`)
    }
  }

  private requireLive(sessionId: string): AgentSessionWrapper {
    const wrapper = this.agent.get(sessionId)
    if (!wrapper?.isAlive()) {
      throw new RuntimeError(
        'SESSION_NOT_RUNNING',
        `Harness session is not running: ${sessionId}`,
        {
          userMessage: 'Start or resume the session first.'
        }
      )
    }
    return wrapper
  }

  private async requireCapability(
    sessionId: string,
    capability: keyof HarnessCapabilities
  ): Promise<AgentSessionWrapper> {
    let wrapper = this.agent.get(sessionId)
    if (!wrapper?.isAlive()) {
      try {
        await this.agent.start({ sessionId })
      } catch {
        throw new RuntimeError('SESSION_NOT_FOUND', `Harness session not found: ${sessionId}`)
      }
      wrapper = this.agent.get(sessionId)
    }
    if (!wrapper?.isAlive()) {
      throw new RuntimeError('SESSION_NOT_RUNNING', `Harness session is not running: ${sessionId}`)
    }
    if (!detectHarnessCapabilities(wrapper.inner)[capability]) {
      throw new RuntimeError(
        'CAPABILITY_NOT_SUPPORTED',
        `Pi Harness capability is unavailable: ${String(capability)}`
      )
    }
    return wrapper
  }
}

function isCompactionResult(value: unknown): value is HarnessCompactionResult {
  return typeof value === 'object' && value !== null && 'cancelled' in value
}
