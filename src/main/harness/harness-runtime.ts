import type { BrowserWindow } from 'electron'
import { IPC_EVENT } from '@shared/ipc/channels'
import type { AgentRuntime } from '../agent/runtime'
import type { AgentStateSnapshot, StartAgentSessionInput, ToolEntry } from '@shared/types/workspace'
import type {
  HarnessCompactionResult,
  HarnessEvent,
  HarnessEventEnvelope,
  HarnessForkResult,
  HarnessSessionInfo,
  HarnessState,
  HarnessStats,
  HarnessTool
} from '@shared/types/harness'
import { log, redactSecretText } from '../services/logger'
import type { HarnessAdapter, HarnessPromptOptions } from './harness-types'

const MAX_TIMELINE_EVENTS = 300

type HarnessEventListener = (payload: HarnessEventEnvelope) => void

/** Single desktop entry point over PiHarnessAdapter. Pi remains the only Agent Runtime. */
export class HarnessRuntime implements AgentRuntime {
  private readonly timelines = new Map<string, HarnessEvent[]>()
  private readonly observedSessions = new Map<string, () => void>()
  private readonly listeners = new Set<HarnessEventListener>()
  private getWindow: () => BrowserWindow | null = () => null

  constructor(private readonly adapter: HarnessAdapter) {}

  diagnostics(): { implementation: 'pi'; sdkLoaded: boolean } {
    return this.adapter.diagnostics()
  }

  attachWindow(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow
  }

  onEvent(listener: HarnessEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  listRunning(): string[] {
    return this.adapter.listRunning()
  }

  async getState(sessionId: string): Promise<AgentStateSnapshot | null> {
    this.observe(sessionId)
    return this.adapter.getAgentState(sessionId)
  }

  async getHarnessState(sessionId: string): Promise<HarnessState | null> {
    this.observe(sessionId)
    return this.adapter.getState(sessionId)
  }

  async getHarnessSession(sessionId: string): Promise<HarnessSessionInfo> {
    this.observe(sessionId)
    return this.adapter.getSession(sessionId)
  }

  getTimeline(sessionId: string): HarnessEvent[] {
    return [...(this.timelines.get(sessionId) ?? [])]
  }

  async start(input: StartAgentSessionInput): Promise<{ sessionId: string; cwd: string }> {
    const result = await this.adapter.startSession(input)
    this.observe(result.sessionId)
    this.emit(result.sessionId, { type: 'session.started', timestamp: Date.now() })
    return result
  }

  async prompt(
    sessionId: string,
    message: string,
    extras: HarnessPromptOptions = {}
  ): Promise<unknown> {
    this.observe(sessionId)
    const queuedType =
      extras.streamingBehavior === 'steer'
        ? 'steering.queued'
        : extras.streamingBehavior === 'followUp'
          ? 'followUp.queued'
          : null
    if (!queuedType) this.emit(sessionId, { type: 'prompt.started', timestamp: Date.now() })
    try {
      const result = await this.adapter.prompt(sessionId, message, extras)
      if (queuedType) this.emit(sessionId, { type: queuedType, timestamp: Date.now() })
      return result
    } catch (error) {
      this.emitError(sessionId, error)
      throw error
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.adapter.abort(sessionId)
    this.emit(sessionId, { type: 'runtime.aborted', timestamp: Date.now() })
  }

  async stop(sessionId: string): Promise<void> {
    await this.adapter.stopSession(sessionId)
    this.emit(sessionId, { type: 'session.stopped', timestamp: Date.now() })
  }

  async command(sessionId: string, command: Record<string, unknown>): Promise<unknown> {
    const type = String(command.type ?? '')
    switch (type) {
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
        return this.setTools(sessionId, (command.toolNames as string[]) ?? [], true)
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
        return this.adapter.executeAgentCommand(sessionId, command)
    }
  }

  async getTools(sessionId: string): Promise<ToolEntry[]> {
    this.observe(sessionId)
    return this.adapter.getTools(sessionId)
  }

  async getHarnessTools(sessionId: string): Promise<HarnessTool[]> {
    return this.getTools(sessionId)
  }

  async setTools(
    sessionId: string,
    toolNames: string[],
    preserveExtensionTools = false
  ): Promise<void> {
    this.observe(sessionId)
    await this.adapter.setTools(sessionId, toolNames, { preserveExtensionTools })
    this.emit(sessionId, {
      type: 'tools.changed',
      timestamp: Date.now(),
      active: (await this.adapter.getTools(sessionId)).filter((tool) => tool.active).length
    })
  }

  async setModel(sessionId: string, provider: string, modelId: string): Promise<void> {
    this.observe(sessionId)
    await this.adapter.setModel(sessionId, provider, modelId)
    this.emit(sessionId, { type: 'model.changed', timestamp: Date.now(), provider, modelId })
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    this.observe(sessionId)
    await this.adapter.setThinkingLevel(sessionId, level)
    this.emit(sessionId, { type: 'thinking.changed', timestamp: Date.now(), level })
  }

  async compact(
    sessionId: string,
    instructions?: string
  ): Promise<HarnessCompactionResult | unknown> {
    this.observe(sessionId)
    const result = await this.adapter.compact(sessionId, instructions)
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
    await this.adapter.abortCompaction(sessionId)
    this.emit(sessionId, { type: 'runtime.aborted', timestamp: Date.now() })
  }

  async setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
    await this.adapter.setAutoCompaction(sessionId, enabled)
    this.emit(sessionId, { type: 'autoCompaction.changed', timestamp: Date.now(), enabled })
  }

  async steer(sessionId: string, message: string, images?: unknown): Promise<void> {
    this.observe(sessionId)
    await this.adapter.steer(sessionId, message, images)
    this.emit(sessionId, { type: 'steering.queued', timestamp: Date.now() })
  }

  async followUp(sessionId: string, message: string, images?: unknown): Promise<void> {
    this.observe(sessionId)
    await this.adapter.followUp(sessionId, message, images)
    this.emit(sessionId, { type: 'followUp.queued', timestamp: Date.now() })
  }

  async fork(sessionId: string, entryId: string): Promise<HarnessForkResult> {
    const result = await this.adapter.fork(sessionId, entryId)
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
    const result = await this.adapter.navigateTree(sessionId, targetId)
    this.emit(sessionId, { type: 'session.navigated', timestamp: Date.now(), targetId })
    return result
  }

  async getStats(sessionId: string): Promise<HarnessStats> {
    this.observe(sessionId)
    return this.adapter.getStats(sessionId)
  }

  defaultToolNames(): string[] {
    return this.adapter.defaultToolNames()
  }

  async shutdownAll(): Promise<void> {
    await this.adapter.shutdownAll()
    for (const unsubscribe of this.observedSessions.values()) unsubscribe()
    this.observedSessions.clear()
  }

  private observe(sessionId: string): void {
    if (this.observedSessions.has(sessionId)) return
    this.observedSessions.set(
      sessionId,
      this.adapter.subscribe(sessionId, (event) => {
        this.emit(sessionId, event)
        if (
          event.type === 'runtime.idle' ||
          event.type === 'compaction.completed' ||
          event.type === 'tools.changed'
        ) {
          void this.emitContext(sessionId)
        }
      })
    )
  }

  private async emitContext(sessionId: string): Promise<void> {
    try {
      const state = await this.adapter.getState(sessionId)
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

  private emitError(sessionId: string, error: unknown): void {
    this.emit(sessionId, {
      type: 'runtime.error',
      timestamp: Date.now(),
      message: redactSecretText(error instanceof Error ? error.message : String(error))
    })
  }

  private emit(sessionId: string, event: HarnessEvent): void {
    // Append in place: copying the capped timeline on every event costs O(n)
    // per event during bursts; readers still receive a defensive copy below.
    let timeline = this.timelines.get(sessionId)
    if (!timeline) {
      timeline = []
      this.timelines.set(sessionId, timeline)
    }
    timeline.push(event)
    if (timeline.length > MAX_TIMELINE_EVENTS) {
      timeline.splice(0, timeline.length - MAX_TIMELINE_EVENTS)
    }
    const payload = { sessionId, event }
    for (const listener of this.listeners) {
      try {
        listener(payload)
      } catch (error) {
        log.agent.error('failed to deliver harness event:', error)
      }
    }
    const win = this.getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    try {
      win.webContents.send(IPC_EVENT.harnessEvent, payload)
    } catch (error) {
      log.agent.error('failed to send harness event:', error)
    }
  }
}

function isCompactionResult(value: unknown): value is HarnessCompactionResult {
  return typeof value === 'object' && value !== null && 'cancelled' in value
}
