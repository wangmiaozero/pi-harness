/**
 * Harness Run Registry (runtime port).
 *
 * Single reducer over the unified HarnessEvent stream. Every Run, step, token
 * and tool failure is derived from events Pi actually emitted — no parallel
 * bookkeeping. Completed runs are additionally reconstructable from the session
 * JSONL so history survives runtime restarts.
 */

import { randomUUID } from 'node:crypto'
import type { SessionEntry } from '../../types.js'
import type {
  HarnessEvent,
  HarnessPolicyBudget,
  HarnessRun,
  HarnessRunRelation,
  HarnessRunStep,
  HarnessRunStatus,
  HarnessState
} from '../types.js'
import { buildRunsFromEntries } from './runs-from-session.js'
import { logDiagnostic } from '../../transport/jsonl.js'

const MAX_RUNS_PER_SESSION = 200
const MAX_STEPS_PER_RUN = 200
const PROMPT_PREVIEW_LENGTH = 200
const RESULT_PREVIEW_LENGTH = 400
/** Wall-clock tolerance when matching a live run to its session entry anchor. */
const ANCHOR_MATCH_TOLERANCE_MS = 5000

const DERIVED_EVENT_TYPES = new Set<string>([
  'run.started',
  'run.completed',
  'run.failed',
  'run.aborted',
  'evaluation.started',
  'evaluation.completed',
  'checkpoint.created',
  'recovery.started',
  'recovery.completed'
])

export interface RunRegistryHooks {
  emit: (sessionId: string, event: HarnessEvent) => void
  getBudget: () => HarnessPolicyBudget
  getEntries?: (sessionId: string) => Promise<SessionEntry[]>
  getHarnessState?: (sessionId: string) => Promise<HarnessState | null>
  getLastAssistantText?: (sessionId: string) => Promise<string | null>
  /** Resolve the session's working directory (project scope of a run). */
  getCwd?: (sessionId: string) => Promise<string | null>
  /** Persisted runs from the run repository (survive runtime restarts). */
  listPersistedRuns?: (sessionId: string) => Promise<HarnessRun[]>
  onBudgetExceeded?: (sessionId: string, runId: string) => Promise<void>
  /** Called after a run reaches its agent-turn verdict (evaluation hook). */
  onRunSettled?: (run: HarnessRun) => Promise<void>
  /** Called once the run reached its final verdict (persistence hook). */
  onRunFinalized?: (run: HarnessRun) => Promise<void>
}

/** Relation metadata applied to the next run created in a session. */
export interface RunRelationAnnotation {
  relation?: Extract<HarnessRunRelation, 'fork' | 'retry' | 'recovery' | 'rerun'>
  forkedFromRunId?: string | null
  forkedFromEventId?: string | null
  forkedFromCheckpointId?: string | null
  /** Multi-agent orchestration binding for the next run. */
  agentId?: string | null
  taskId?: string | null
  orchestrationId?: string | null
}

interface LiveRun {
  run: HarnessRun
  anchorEntryId: string | null
  openToolStepIds: Map<string, string>
  settled: boolean
  settledStatus: HarnessRunStatus
  evaluationPending: boolean
  budgetExceeded: boolean
  finalized: boolean
}

export class RunRegistry {
  private readonly sessions = new Map<string, LiveRun[]>()
  private readonly active = new Map<string, LiveRun>()
  private readonly annotations = new Map<string, RunRelationAnnotation>()
  private stepCounter = 0

  constructor(private readonly hooks: RunRegistryHooks) {}

  /** Tag the next run in this session as a fork / retry / recovery / re-run. */
  annotateNextRun(sessionId: string, annotation: RunRelationAnnotation): void {
    this.annotations.set(sessionId, annotation)
  }

  handleEvent(sessionId: string, event: HarnessEvent): void {
    if (DERIVED_EVENT_TYPES.has(event.type)) return
    try {
      this.reduce(sessionId, event)
    } catch (error) {
      logDiagnostic(
        `run registry failed to reduce event: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  getCurrentRun(sessionId: string): HarnessRun | null {
    return this.active.get(sessionId)?.run ?? null
  }

  /** All live runs across sessions (multi-agent orchestration rollups). */
  listAllLiveRuns(): HarnessRun[] {
    return [...this.sessions.values()].flat().map((live) => live.run)
  }

  async listRuns(sessionId: string): Promise<HarnessRun[]> {
    const live = this.sessions.get(sessionId) ?? []
    const anchors = new Set(
      live
        .map((entry) => entry.anchorEntryId ?? entry.run.anchorEntryId ?? null)
        .filter(Boolean) as string[]
    )
    const activeRun = this.active.get(sessionId)
    if (activeRun?.anchorEntryId) anchors.add(activeRun.anchorEntryId)

    const history: HarnessRun[] = []
    if (this.hooks.getEntries) {
      try {
        const entries = await this.hooks.getEntries(sessionId)
        for (const { run, entryIds } of buildRunsFromEntries(entries)) {
          const anchor = entryIds[0] ?? null
          if (anchor && anchors.has(anchor)) continue
          if (this.active.get(sessionId)?.anchorEntryId === anchor) continue
          history.push({ ...run, sessionId })
        }
      } catch (error) {
        logDiagnostic(
          `run history reconstruction failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    const persisted: HarnessRun[] = []
    if (this.hooks.listPersistedRuns) {
      try {
        for (const run of await this.hooks.listPersistedRuns(sessionId)) {
          if (run.anchorEntryId) anchors.add(run.anchorEntryId)
          persisted.push(run)
        }
      } catch (error) {
        logDiagnostic(
          `persisted run lookup failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    // Persisted runs replace history reconstructions with the same anchor.
    const persistedAnchors = new Set(
      persisted.map((run) => run.anchorEntryId).filter(Boolean) as string[]
    )
    const filteredHistory = history.filter(
      (run) => !(run.id.startsWith('h:') && persistedAnchors.has(run.id.slice(2)))
    )

    const all = [
      ...(activeRun ? [{ ...activeRun.run, steps: [...activeRun.run.steps] }] : []),
      ...live.map((entry) => ({ ...entry.run, steps: [...entry.run.steps] })),
      ...persisted,
      ...filteredHistory
    ]
    const seen = new Set<string>()
    return all
      .filter((run) => (seen.has(run.id) ? false : seen.add(run.id)))
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_RUNS_PER_SESSION)
  }

  async getRun(sessionId: string, runId: string): Promise<HarnessRun | null> {
    const activeRun = this.active.get(sessionId)
    if (activeRun && activeRun.run.id === runId) return { ...activeRun.run }
    const live = this.sessions.get(sessionId)?.find((entry) => entry.run.id === runId)
    if (live) return { ...live.run }
    return (await this.listRuns(sessionId)).find((run) => run.id === runId) ?? null
  }

  /** Mark the run as passing through engineering evaluation before its verdict. */
  markEvaluating(sessionId: string, runId: string): void {
    const entry = this.findLive(sessionId, runId)
    if (!entry || entry.finalized) return
    entry.evaluationPending = true
    if (!entry.settled) return
    entry.run.status = 'verifying'
  }

  /** Apply the post-evaluation verdict and emit the final run event. */
  completeRun(
    sessionId: string,
    runId: string,
    status?: HarnessRunStatus,
    error?: string
  ): HarnessEvent[] {
    const entry = this.findLive(sessionId, runId)
    if (!entry || entry.finalized) return []
    entry.run.status = status ?? entry.settledStatus
    if (error) entry.run.error = error.slice(0, 500)
    entry.finalized = true
    this.active.delete(sessionId)
    this.emitRunVerdict(sessionId, entry.run)
    void this.finalizeRun(entry.run)
    return []
  }

  private async finalizeRun(run: HarnessRun): Promise<void> {
    if (!this.hooks.onRunFinalized) return
    try {
      await this.hooks.onRunFinalized(run)
    } catch (error) {
      logDiagnostic(
        `run finalization failed for ${run.id}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /** Attach a checkpoint id to the active (or given) run. */
  attachCheckpoint(sessionId: string, checkpointId: string, runId?: string | null): void {
    const entry = runId ? this.findLive(sessionId, runId) : this.active.get(sessionId)
    if (!entry) return
    if (!entry.run.checkpointIds.includes(checkpointId)) {
      entry.run.checkpointIds.push(checkpointId)
    }
  }

  // ------------------------------------------------------------------ reducer

  private reduce(sessionId: string, event: HarnessEvent): void {
    switch (event.type) {
      case 'prompt.started': {
        const previous = this.active.get(sessionId)
        if (previous && !previous.settled) this.settleRun(sessionId, previous, 'success')
        const annotation = this.annotations.get(sessionId) ?? null
        this.annotations.delete(sessionId)
        const run: HarnessRun = {
          id: `run-${randomUUID()}`,
          sessionId,
          parentRunId: annotation?.forkedFromRunId ?? previous?.run.id ?? null,
          relation: annotation?.relation ?? 'original',
          forkedFromRunId: annotation?.forkedFromRunId ?? null,
          forkedFromEventId: annotation?.forkedFromEventId ?? null,
          forkedFromCheckpointId: annotation?.forkedFromCheckpointId ?? null,
          status: 'queued',
          source: 'live',
          anchorEntryId: null,
          cwd: null,
          agentId: annotation?.agentId ?? null,
          taskId: annotation?.taskId ?? null,
          orchestrationId: annotation?.orchestrationId ?? null,
          startedAt: event.timestamp,
          finishedAt: null,
          model: null,
          provider: null,
          prompt: (event.message ?? '').slice(0, PROMPT_PREVIEW_LENGTH),
          usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, estimatedCost: null },
          toolCallCount: 0,
          toolFailureCount: 0,
          contextUsage: null,
          result: null,
          error: null,
          budgetExceeded: null,
          steps: [],
          checkpointIds: []
        }
        const live: LiveRun = {
          run,
          anchorEntryId: null,
          openToolStepIds: new Map(),
          settled: false,
          settledStatus: 'running',
          evaluationPending: false,
          budgetExceeded: false,
          finalized: false
        }
        this.active.set(sessionId, live)
        this.push(sessionId, live)
        this.hooks.emit(sessionId, {
          type: 'run.started',
          timestamp: event.timestamp,
          runId: run.id,
          prompt: run.prompt
        })
        void this.captureRunContext(sessionId, live)
        return
      }
      case 'message.started': {
        const live = this.active.get(sessionId)
        if (live && live.run.status === 'queued') live.run.status = 'running'
        return
      }
      case 'message.completed': {
        const live = this.active.get(sessionId)
        if (!live) return
        if (live.run.status === 'queued') live.run.status = 'running'
        if (event.usage) {
          live.run.usage.inputTokens += event.usage.input
          live.run.usage.outputTokens += event.usage.output
          live.run.usage.cachedTokens += event.usage.cacheRead
          live.run.usage.totalTokens +=
            event.usage.input + event.usage.output + event.usage.cacheRead
          if (event.usage.cost !== null && Number.isFinite(event.usage.cost)) {
            live.run.usage.estimatedCost =
              (live.run.usage.estimatedCost ?? 0) + event.usage.cost
          }
        }
        if (event.model && !live.run.model) live.run.model = event.model
        if (event.provider && !live.run.provider) live.run.provider = event.provider
        this.checkBudget(sessionId, live)
        return
      }
      case 'tool.started': {
        const live = this.active.get(sessionId)
        if (!live) return
        if (live.run.status === 'queued' || live.run.status === 'running')
          live.run.status = 'tool-calling'
        const stepId = `step-${++this.stepCounter}`
        live.openToolStepIds.set(
          event.toolCallId ?? `${event.toolName}:${event.timestamp}`,
          stepId
        )
        this.addStep(live, {
          id: stepId,
          kind: 'tool',
          name: event.toolName,
          status: 'running',
          startedAt: event.timestamp
        })
        return
      }
      case 'tool.completed': {
        const live = this.active.get(sessionId)
        if (!live) return
        live.run.toolCallCount += 1
        if (event.isError) live.run.toolFailureCount += 1
        const key = event.toolCallId ?? `${event.toolName}:${event.timestamp}`
        let stepId = live.openToolStepIds.get(key)
        if (!stepId && !event.toolCallId) {
          // Synthetic events without a toolCallId cannot be correlated by
          // identity — fall back to the oldest open step with the same name.
          const openId = live.run.steps.find(
            (candidate) =>
              candidate.kind === 'tool' &&
              candidate.name === event.toolName &&
              candidate.status === 'running' &&
              [...live.openToolStepIds.values()].includes(candidate.id)
          )?.id
          stepId = openId
        }
        if (stepId) {
          live.openToolStepIds.delete(key)
          const step = live.run.steps.find((candidate) => candidate.id === stepId)
          if (step) {
            step.status = event.isError ? 'failed' : 'success'
            step.finishedAt = event.timestamp
          }
        }
        if (live.run.status === 'tool-calling') live.run.status = 'running'
        this.checkBudget(sessionId, live)
        return
      }
      case 'compaction.started': {
        const live = this.active.get(sessionId)
        if (!live) return
        this.addStep(live, {
          id: `step-${++this.stepCounter}`,
          kind: 'compaction',
          name: 'compaction',
          status: 'running',
          startedAt: event.timestamp
        })
        return
      }
      case 'compaction.completed': {
        const live = this.active.get(sessionId)
        if (!live) return
        const step = [...live.run.steps].reverse().find((candidate) => candidate.kind === 'compaction' && candidate.status === 'running')
        if (step) {
          step.status = event.aborted ? 'skipped' : 'success'
          step.finishedAt = event.timestamp
        }
        return
      }
      case 'policy.denied': {
        const live = this.active.get(sessionId)
        if (!live) return
        this.addStep(live, {
          id: `step-${++this.stepCounter}`,
          kind: 'policy',
          name: `${event.domain}: ${event.target}`.slice(0, 120),
          status: 'skipped',
          startedAt: event.timestamp,
          finishedAt: event.timestamp,
          detail: `denied by ${event.rule}`
        })
        return
      }
      case 'policy.allowed':
      case 'policy.confirmed': {
        const live = this.active.get(sessionId)
        if (!live || event.type !== 'policy.confirmed') return
        this.addStep(live, {
          id: `step-${++this.stepCounter}`,
          kind: 'policy',
          name: `${event.domain}: ${event.target}`.slice(0, 120),
          status: event.allowed ? 'success' : 'skipped',
          startedAt: event.timestamp,
          finishedAt: event.timestamp,
          detail: event.allowed ? 'confirmed by user' : 'denied by user'
        })
        return
      }
      case 'runtime.error': {
        const live = this.active.get(sessionId)
        if (!live) return
        live.run.error = event.message.slice(0, 500)
        this.addStep(live, {
          id: `step-${++this.stepCounter}`,
          kind: 'error',
          name: 'runtime error',
          status: 'failed',
          startedAt: event.timestamp,
          finishedAt: event.timestamp,
          detail: event.message.slice(0, 200)
        })
        this.settleRun(sessionId, live, 'failed', event.message)
        return
      }
      case 'runtime.aborted': {
        const live = this.active.get(sessionId)
        if (!live) return
        if (live.settled && !live.finalized) {
          // prompt.completed raced ahead of the abort signal — abort wins.
          live.settledStatus = 'aborted'
          live.run.status = 'aborted'
          return
        }
        this.settleRun(sessionId, live, 'aborted')
        return
      }
      case 'prompt.completed': {
        const live = this.active.get(sessionId)
        if (live && !live.settled) this.settleRun(sessionId, live, 'success')
        return
      }
      case 'runtime.idle': {
        const live = this.active.get(sessionId)
        if (live && !live.settled) this.settleRun(sessionId, live, 'success')
        return
      }
      case 'session.stopped':
      case 'session.forked': {
        const live = this.active.get(sessionId)
        if (live && !live.settled) this.settleRun(sessionId, live, 'aborted')
        return
      }
      default:
        return
    }
  }

  /** The agent turn reached a verdict; evaluation (if any) finishes the run. */
  private settleRun(
    sessionId: string,
    live: LiveRun,
    status: HarnessRunStatus,
    error?: string
  ): void {
    if (live.settled) return
    live.settled = true
    live.settledStatus = status
    live.run.status = status
    live.run.finishedAt = Date.now()
    if (error && !live.run.error) live.run.error = error.slice(0, 500)
    for (const step of live.run.steps) {
      if (step.status === 'running') {
        step.status = 'skipped'
        step.finishedAt = live.run.finishedAt
      }
    }
    void this.captureRunOutcome(sessionId, live)
  }

  private async captureRunCwd(sessionId: string, live: LiveRun): Promise<void> {
    if (!this.hooks.getCwd || live.run.cwd) return
    try {
      const cwd = await this.hooks.getCwd(sessionId)
      if (cwd) live.run.cwd = cwd
    } catch {
      /* cwd capture is best-effort */
    }
  }

  private async captureAnchor(sessionId: string, live: LiveRun): Promise<void> {
    if (!this.hooks.getEntries) return
    try {
      const entries = await this.hooks.getEntries(sessionId)
      const startBoundary = live.run.startedAt - ANCHOR_MATCH_TOLERANCE_MS
      for (const entry of entries) {
        if (entry.type !== 'message') continue
        const message = entry.message as { role?: string } | undefined
        if (message?.role !== 'user') continue
        const timestamp = Date.parse(entry.timestamp)
        if (!Number.isFinite(timestamp)) continue
        if (timestamp >= startBoundary) {
          live.anchorEntryId = entry.id
          live.run.anchorEntryId = entry.id
          return
        }
      }
    } catch {
      /* anchor matching is best-effort; without it the run stays live-sourced */
    }
  }

  private async captureRunContext(sessionId: string, live: LiveRun): Promise<void> {
    if (!this.hooks.getHarnessState) return
    try {
      const state = await this.hooks.getHarnessState(sessionId)
      if (state?.context && this.active.get(sessionId) === live && !live.settled) {
        live.run.contextUsage = state.context
      }
    } catch {
      /* context capture is best-effort */
    }
  }

  private async captureRunOutcome(sessionId: string, live: LiveRun): Promise<void> {
    // Anchor + cwd must be settled before evaluation completes the run, so
    // the persisted record carries them.
    await this.captureAnchor(sessionId, live)
    await this.captureRunCwd(sessionId, live)
    if (this.hooks.getLastAssistantText) {
      try {
        const text = await this.hooks.getLastAssistantText(sessionId)
        if (text) live.run.result = text.slice(0, RESULT_PREVIEW_LENGTH)
      } catch {
        /* result preview is best-effort */
      }
    }
    if (this.hooks.onRunSettled && !live.finalized) {
      try {
        await this.hooks.onRunSettled(live.run)
      } catch (error) {
        logDiagnostic(
          `run settled hook failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    // When no evaluation runs, finish the run immediately.
    if (!live.finalized && !live.evaluationPending) {
      this.completeRun(sessionId, live.run.id)
    }
  }

  private emitRunVerdict(sessionId: string, run: HarnessRun): void {
    const timestamp = Date.now()
    if (run.status === 'failed') {
      this.hooks.emit(sessionId, {
        type: 'run.failed',
        timestamp,
        runId: run.id,
        ...(run.error ? { error: run.error } : {})
      })
      return
    }
    if (run.status === 'aborted') {
      this.hooks.emit(sessionId, { type: 'run.aborted', timestamp, runId: run.id })
      return
    }
    this.hooks.emit(sessionId, {
      type: 'run.completed',
      timestamp,
      runId: run.id,
      status: run.status
    })
  }

  private checkBudget(sessionId: string, live: LiveRun): void {
    if (live.budgetExceeded || live.finalized) return
    const budget = this.hooks.getBudget()
    const usage = live.run.usage
    let limit: string | null = null
    let value = ''
    if (budget.maxTokens !== null && usage.totalTokens > budget.maxTokens) {
      limit = 'maxTokens'
      value = `${usage.totalTokens} > ${budget.maxTokens}`
    } else if (
      budget.maxCost !== null &&
      (usage.estimatedCost ?? 0) > budget.maxCost
    ) {
      limit = 'maxCost'
      value = `$${usage.estimatedCost?.toFixed(4)} > $${budget.maxCost}`
    } else if (budget.maxToolCalls !== null && live.run.toolCallCount > budget.maxToolCalls) {
      limit = 'maxToolCalls'
      value = `${live.run.toolCallCount} > ${budget.maxToolCalls}`
    } else if (
      budget.maxRunDurationMs !== null &&
      Date.now() - live.run.startedAt > budget.maxRunDurationMs
    ) {
      limit = 'maxRunDurationMs'
      value = `${Date.now() - live.run.startedAt}ms > ${budget.maxRunDurationMs}ms`
    }
    if (!limit) return
    live.budgetExceeded = true
    live.run.budgetExceeded = `${limit}: ${value}`
    this.hooks.emit(sessionId, {
      type: 'budget.exceeded',
      timestamp: Date.now(),
      runId: live.run.id,
      limit,
      value
    })
    void this.hooks.onBudgetExceeded?.(sessionId, live.run.id).catch((error) => {
      logDiagnostic(
        `budget enforcement failed: ${error instanceof Error ? error.message : String(error)}`
      )
    })
  }

  private addStep(live: LiveRun, step: HarnessRunStep): void {
    if (live.run.steps.length >= MAX_STEPS_PER_RUN) live.run.steps.shift()
    live.run.steps.push(step)
  }

  private push(sessionId: string, live: LiveRun): void {
    const runs = this.sessions.get(sessionId) ?? []
    runs.push(live)
    this.sessions.set(sessionId, runs)
  }

  private findLive(sessionId: string, runId: string): LiveRun | null {
    return (
      this.active.get(sessionId) ??
      this.sessions.get(sessionId)?.find((entry) => entry.run.id === runId) ??
      null
    )
  }
}
