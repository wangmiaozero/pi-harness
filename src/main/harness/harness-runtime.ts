import type { BrowserWindow } from 'electron'
import { IPC_EVENT } from '@shared/ipc/channels'
import type { AgentRuntime } from '../agent/runtime'
import type {
  AgentStateSnapshot,
  GitStatusResponse,
  SessionEntry,
  StartAgentSessionInput,
  ToolEntry
} from '@shared/types/workspace'
import type {
  HarnessCompactionResult,
  HarnessEvent,
  HarnessEventEnvelope,
  HarnessEvaluation,
  HarnessForkResult,
  HarnessPolicyConfig,
  HarnessPolicyDecisionReport,
  HarnessPolicySnapshot,
  HarnessRun,
  HarnessRunStatus,
  HarnessSessionInfo,
  HarnessState,
  HarnessStats,
  HarnessTool,
  HarnessCheckpoint
} from '@shared/types/harness'
import { log, redactSecretText } from '../services/logger'
import { JsonStore } from '../services/storage'
import { harnessCheckpointsPath, harnessPolicyPath } from '../services/app-paths'
import type { GitService } from '../git/git-service'
import type { SessionService } from '../sessions/session-service'
import type { HarnessAdapter, HarnessPromptOptions } from './harness-types'
import { HarnessError } from './harness-error'
import { PolicyEngine } from './policy/policy-engine'
import { DEFAULT_POLICY_CONFIG } from './policy/policy-defaults'
import { RunRegistry } from './runs/run-registry'
import {
  CheckpointService,
  EMPTY_CHECKPOINT_STORE,
  type CheckpointGitState,
  type CheckpointStoreRecord
} from './checkpoint/checkpoint-service'
import { EvaluationService } from './evaluation/evaluation-service'

const MAX_TIMELINE_EVENTS = 300

type HarnessEventListener = (payload: HarnessEventEnvelope) => void

export interface HarnessRuntimeOptions {
  /** Shared policy engine (created by the host before the agent runtime). */
  policy?: PolicyEngine
  /** Policy store; used when no engine is injected. Defaults to the app userData policy file. */
  policyStore?: JsonStore<HarnessPolicyConfig>
  /** Checkpoint store; defaults to the app userData checkpoint file. */
  checkpointStore?: JsonStore<CheckpointStoreRecord>
  /** Session persistence service (run history + evaluation evidence). */
  sessions?: SessionService
  /** Git service (checkpoint anchors, evaluation workspace checks). */
  git?: GitService
}

/**
 * Single desktop entry point over PiHarnessAdapter, extended into the Harness
 * Control Plane. Pi remains the only Agent Runtime — this class observes,
 * inspects and controls; it never re-implements agent behavior.
 */
export class HarnessRuntime implements AgentRuntime {
  private readonly timelines = new Map<string, HarnessEvent[]>()
  private readonly observedSessions = new Map<string, () => void>()
  private readonly listeners = new Set<HarnessEventListener>()
  private getWindow: () => BrowserWindow | null = () => null
  private git: GitService | null = null
  private sessions: SessionService | null = null

  readonly policy: PolicyEngine
  readonly runs: RunRegistry
  readonly checkpoints: CheckpointService
  readonly evaluation: EvaluationService

  constructor(
    private readonly adapter: HarnessAdapter,
    options: HarnessRuntimeOptions = {}
  ) {
    this.policy =
      options.policy ??
      new PolicyEngine(
        options.policyStore ?? new JsonStore(harnessPolicyPath(), structuredClone(DEFAULT_POLICY_CONFIG))
      )
    this.runs = new RunRegistry({
      emit: (sessionId, event) => this.emit(sessionId, event),
      getBudget: () => this.policy.budget(),
      getEntries: options.sessions
        ? (sessionId) => options.sessions!.readRawEntries(sessionId)
        : undefined,
      getHarnessState: (sessionId) => this.adapter.getState(sessionId),
      getLastAssistantText: (sessionId) => this.lastAssistantText(sessionId),
      onBudgetExceeded: async (sessionId) => {
        await this.abort(sessionId)
      },
      onRunSettled: (run) => this.handleRunSettled(run)
    })
    this.checkpoints = new CheckpointService(
      options.checkpointStore ?? new JsonStore(harnessCheckpointsPath(), EMPTY_CHECKPOINT_STORE),
      {
        getSessionState: (sessionId) => this.checkpointSessionState(sessionId),
        getGitState: async (cwd) => this.checkpointGitState(cwd),
        getContextState: async (sessionId) => {
          try {
            const state = await this.adapter.getState(sessionId)
            return state?.context
              ? { percent: state.context.percent, tokens: state.context.tokens }
              : null
          } catch {
            return null
          }
        },
        navigateTree: (sessionId, entryId) => this.navigateTree(sessionId, entryId),
        fork: (sessionId, entryId) => this.fork(sessionId, entryId),
        prompt: (sessionId, message) => this.prompt(sessionId, message),
        getLastRetryablePrompt: (sessionId) => this.lastRetryablePrompt(sessionId),
        emit: (sessionId, event) => this.emit(sessionId, event),
        attachToRun: (sessionId, checkpointId, runId) =>
          this.runs.attachCheckpoint(sessionId, checkpointId, runId)
      }
    )
    this.evaluation = new EvaluationService({
      getEntries: options.sessions
        ? (sessionId) => options.sessions!.readRawEntries(sessionId)
        : async () => [],
      getGitStatus: (sessionId) => this.gitStatusForSession(sessionId)
    })
    if (options.git) this.git = options.git
    if (options.sessions) this.sessions = options.sessions
  }

  diagnostics(): { implementation: 'pi'; sdkLoaded: boolean } {
    return this.adapter.diagnostics()
  }

  attachWindow(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow
    this.policy.attachWindow(getWindow)
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

  // ------------------------------------------------------------- run surface

  async listRuns(sessionId: string): Promise<HarnessRun[]> {
    return this.runs.listRuns(sessionId)
  }

  async getRun(sessionId: string, runId: string): Promise<HarnessRun> {
    const run = await this.runs.getRun(sessionId, runId)
    if (!run) {
      throw new HarnessError('RUN_NOT_FOUND', `Run not found: ${runId}`, { sessionId, runId })
    }
    return run
  }

  // ---------------------------------------------------------- policy surface

  async getPolicySnapshot(): Promise<HarnessPolicySnapshot> {
    return this.policy.snapshot()
  }

  async updatePolicy(config: HarnessPolicyConfig): Promise<HarnessPolicySnapshot> {
    const snapshot = await this.policy.update(config)
    log.harness.info('policy configuration updated')
    return snapshot
  }

  /** Sink for decisions made at the tool boundary (policy-tool-guard). */
  recordPolicyDecision(sessionId: string, report: HarnessPolicyDecisionReport): void {
    if (report.decision === 'ask') {
      this.emit(sessionId, {
        type: 'policy.confirmed',
        timestamp: Date.now(),
        domain: report.domain,
        target: report.target,
        allowed: report.allowed
      })
      return
    }
    if (report.decision === 'deny' || !report.allowed) {
      this.emit(sessionId, {
        type: report.decision === 'deny' ? 'policy.denied' : 'policy.allowed',
        timestamp: Date.now(),
        domain: report.domain,
        target: report.target,
        rule: report.rule
      })
      return
    }
    this.emit(sessionId, {
      type: 'policy.allowed',
      timestamp: Date.now(),
      domain: report.domain,
      target: report.target,
      rule: report.rule
    })
  }

  // ------------------------------------------------------ checkpoint surface

  async listCheckpoints(sessionId: string): Promise<HarnessCheckpoint[]> {
    return this.checkpoints.list(sessionId)
  }

  async createCheckpoint(
    sessionId: string,
    options: {
      reason: HarnessCheckpoint['reason']
      includeGit?: boolean
      runId?: string | null
    } = { reason: 'manual' }
  ): Promise<HarnessCheckpoint> {
    return this.checkpoints.create(sessionId, options)
  }

  async resumeCheckpoint(
    checkpointId: string,
    message?: string
  ): Promise<{ resumed: boolean; prompted: boolean }> {
    return this.checkpoints.resume(checkpointId, message)
  }

  async forkCheckpoint(checkpointId: string): Promise<HarnessForkResult> {
    return this.checkpoints.fork(checkpointId)
  }

  async retryLastRun(sessionId: string): Promise<{ retried: boolean; prompt: string | null }> {
    return this.checkpoints.retryLastRun(sessionId)
  }

  // ------------------------------------------------------ evaluation surface

  async listEvaluations(sessionId: string): Promise<HarnessEvaluation[]> {
    return this.evaluation.list(sessionId)
  }

  async evaluateRun(sessionId: string, runId: string): Promise<HarnessEvaluation> {
    const run = await this.getRun(sessionId, runId)
    const inProgress: HarnessRunStatus[] = ['queued', 'running', 'waiting', 'tool-calling', 'verifying']
    if (inProgress.includes(run.status)) {
      throw new HarnessError('RUN_NOT_FOUND', 'Run is still in progress.', { sessionId, runId })
    }
    this.emit(sessionId, { type: 'evaluation.started', timestamp: Date.now(), runId })
    const evaluation = await this.evaluation.evaluate(sessionId, run)
    this.emit(sessionId, {
      type: 'evaluation.completed',
      timestamp: Date.now(),
      runId,
      status: evaluation.status
    })
    return evaluation
  }

  // --------------------------------------------------------- agent surface

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
    if (!queuedType) {
      this.emit(sessionId, { type: 'prompt.started', timestamp: Date.now(), message })
      void this.autoPreRunCheckpoint(sessionId)
    }
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

  // ------------------------------------------------------------ run pipeline

  /**
   * The agent turn reached its verdict. If policy enables evaluation, the run
   * passes through the engineering checks before its final status is emitted.
   */
  private async handleRunSettled(run: HarnessRun): Promise<void> {
    if (!this.policy.autoEvaluate()) return
    this.runs.markEvaluating(run.sessionId, run.id)
    this.emit(run.sessionId, {
      type: 'evaluation.started',
      timestamp: Date.now(),
      runId: run.id
    })
    try {
      const evaluation = await this.evaluation.evaluate(run.sessionId, run)
      this.emit(run.sessionId, {
        type: 'evaluation.completed',
        timestamp: Date.now(),
        runId: run.id,
        status: evaluation.status
      })
    } catch (error) {
      log.harness.warn(`auto evaluation failed for run ${run.id}:`, error)
    } finally {
      this.runs.completeRun(run.sessionId, run.id)
    }
  }

  private async autoPreRunCheckpoint(sessionId: string): Promise<void> {
    if (!this.policy.autoPreRunCheckpoint()) return
    try {
      await this.checkpoints.create(sessionId, { reason: 'pre-run', includeGit: true })
    } catch (error) {
      log.harness.warn(`pre-run checkpoint failed for ${sessionId}:`, error)
    }
  }

  private async checkpointSessionState(sessionId: string): Promise<{
    leafId: string | null
    cwd: string | null
  }> {
    let leafId: string | null = null
    try {
      leafId = (await this.adapter.getSession(sessionId)).leafId
    } catch {
      /* not a live session — fall back to persisted entries */
    }
    if (!leafId && this.sessions) {
      try {
        leafId = (await this.sessions.get(sessionId)).leafId
      } catch {
        /* no persisted session either */
      }
    }
    return { leafId, cwd: await this.sessionCwd(sessionId) }
  }

  private async checkpointGitState(cwd: string | null): Promise<CheckpointGitState | null> {
    if (!cwd || !this.git) return null
    try {
      return await this.git.headInfo(cwd)
    } catch {
      return null
    }
  }

  private async sessionCwd(sessionId: string): Promise<string | null> {
    if (!this.sessions) return null
    try {
      const sessions = await this.sessions.list()
      return sessions.find((session) => session.id === sessionId)?.cwd ?? null
    } catch {
      return null
    }
  }

  private async gitStatusForSession(sessionId: string): Promise<GitStatusResponse | null> {
    const cwd = await this.sessionCwd(sessionId)
    if (!cwd || !this.git) return null
    try {
      return await this.git.status(cwd)
    } catch {
      return null
    }
  }

  private async lastAssistantText(sessionId: string): Promise<string | null> {
    const entries = await this.readSessionEntries(sessionId)
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry.type !== 'message') continue
      const message = entry.message as { role?: string; content?: unknown } | undefined
      if (message?.role !== 'assistant') continue
      const text = extractText(message.content)
      if (text.trim()) return text
    }
    return null
  }

  private async lastRetryablePrompt(sessionId: string): Promise<string | null> {
    const runs = await this.runs.listRuns(sessionId)
    const candidate = runs.find(
      (run) => (run.status === 'failed' || run.status === 'aborted') && run.prompt.trim()
    )
    return candidate?.prompt ?? null
  }

  private async readSessionEntries(sessionId: string): Promise<SessionEntry[]> {
    if (!this.sessions) return []
    try {
      return await this.sessions.readRawEntries(sessionId)
    } catch {
      return []
    }
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
    if (!this.observedSessions.has(sessionId)) this.observe(sessionId)
    // Append the source event first so derived run events (run.started, …)
    // land directly after the event that produced them.
    let timeline = this.timelines.get(sessionId)
    if (!timeline) {
      timeline = []
      this.timelines.set(sessionId, timeline)
    }
    timeline.push(event)
    if (timeline.length > MAX_TIMELINE_EVENTS) {
      timeline.splice(0, timeline.length - MAX_TIMELINE_EVENTS)
    }
    this.deliver(sessionId, event)
    // Reduce after delivery: registry-derived events (run.started, run.failed, …)
    // are emitted recursively and therefore land right after this event.
    this.runs.handleEvent(sessionId, event)
  }

  private deliver(sessionId: string, event: HarnessEvent): void {
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

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const record = block as { type?: string; text?: unknown }
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join('\n')
}

function isCompactionResult(value: unknown): value is HarnessCompactionResult {
  return typeof value === 'object' && value !== null && 'cancelled' in value
}
