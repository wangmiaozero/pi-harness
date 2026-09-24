import type { BrowserWindow } from 'electron'
import os from 'node:os'
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
  HarnessArtifact,
  HarnessBaseline,
  HarnessCompactionResult,
  HarnessEvent,
  HarnessEventEnvelope,
  HarnessEvaluation,
  HarnessExportResult,
  HarnessForkResult,
  HarnessPolicyConfig,
  HarnessPolicyDecisionReport,
  HarnessPolicySnapshot,
  HarnessProjectStats,
  HarnessRegressionReport,
  HarnessRun,
  HarnessRunComparison,
  HarnessRunDetail,
  HarnessRunStatus,
  HarnessRunTreeNode,
  HarnessSessionInfo,
  HarnessState,
  HarnessStats,
  HarnessStatsRange,
  HarnessStoreSettings,
  HarnessTool,
  HarnessCheckpoint
} from '@shared/types/harness'
import { log, redactSecretText } from '../services/logger'
import { JsonStore } from '../services/storage'
import {
  harnessArtifactsPath,
  harnessBaselinesPath,
  harnessCheckpointsPath,
  harnessEvaluationsPath,
  harnessPolicyPath,
  harnessRunsPath,
  harnessStoreSettingsPath,
  harnessTracesPath
} from '../services/app-paths'
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
import {
  EMPTY_EVALUATION_STORE,
  EvaluationService,
  type EvaluationStoreRecord
} from './evaluation/evaluation-service'
import {
  JsonRunRepository,
  buildRunTree,
  type RunRepository,
  type RunStoreRecord
} from './runs/run-repository'
import {
  EMPTY_ARTIFACT_STORE,
  ArtifactService,
  type ArtifactStoreRecord
} from './artifacts/artifact-service'
import {
  EMPTY_TRACE_STORE,
  JsonTraceRepository,
  type TraceStoreRecord
} from './trace/trace-repository'
import { TraceService } from './trace/trace-service'
import { ReplayService } from './replay/replay-service'
import {
  EMPTY_BASELINE_STORE,
  RegressionService,
  type BaselineStoreRecord
} from './regression/regression-service'
import { DiagnosticsService, buildInsights } from './diagnostics/diagnostics-service'
import { compareRuns } from './compare/compare-service'
import { RunExportService } from './export/run-export-service'

const MAX_TIMELINE_EVENTS = 300
export const DEFAULT_STORE_SETTINGS: HarnessStoreSettings = {
  schemaVersion: 1,
  retentionDays: 30,
  maxEventsPerRun: 400
}

type HarnessEventListener = (payload: HarnessEventEnvelope) => void

export interface HarnessRuntimeOptions {
  /** Shared policy engine (created by the host before the agent runtime). */
  policy?: PolicyEngine
  /** Policy store; used when no engine is injected. Defaults to the app userData policy file. */
  policyStore?: JsonStore<HarnessPolicyConfig>
  /** Checkpoint store; defaults to the app userData checkpoint file. */
  checkpointStore?: JsonStore<CheckpointStoreRecord>
  /** Run repository store (persisted run history). */
  runStore?: JsonStore<RunStoreRecord>
  /** Trace repository store (recorded run traces). */
  traceStore?: JsonStore<TraceStoreRecord>
  /** Artifact store (persisted run artifacts). */
  artifactStore?: JsonStore<ArtifactStoreRecord>
  /** Evaluation store (persisted evaluations). */
  evaluationStore?: JsonStore<EvaluationStoreRecord>
  /** Baseline store (regression baselines, keyed by project cwd). */
  baselineStore?: JsonStore<BaselineStoreRecord>
  /** Harness data retention settings store. */
  storeSettingsStore?: JsonStore<HarnessStoreSettings>
  /** Session persistence service (run history + evaluation evidence). */
  sessions?: SessionService
  /** Git service (checkpoint anchors, evaluation workspace checks). */
  git?: GitService
  /** App version, stamped into debug bundles. */
  appVersion?: string
  /** Pi SDK version, stamped into debug bundles. */
  piVersion?: string | null
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
  readonly trace: TraceService
  readonly artifacts: ArtifactService
  readonly replay: ReplayService
  readonly regression: RegressionService
  readonly diagnosticsService: DiagnosticsService
  readonly storeSettings: JsonStore<HarnessStoreSettings>
  private readonly runRepository: RunRepository
  private readonly exportService: RunExportService

  constructor(
    private readonly adapter: HarnessAdapter,
    options: HarnessRuntimeOptions = {}
  ) {
    const runStore =
      options.runStore ?? new JsonStore(harnessRunsPath(), { schemaVersion: 1, runs: [] })
    const traceStore = options.traceStore ?? new JsonStore(harnessTracesPath(), EMPTY_TRACE_STORE)
    const artifactStore =
      options.artifactStore ?? new JsonStore(harnessArtifactsPath(), EMPTY_ARTIFACT_STORE)
    const evaluationStore =
      options.evaluationStore ?? new JsonStore(harnessEvaluationsPath(), EMPTY_EVALUATION_STORE)
    const baselineStore =
      options.baselineStore ?? new JsonStore(harnessBaselinesPath(), EMPTY_BASELINE_STORE)
    this.storeSettings =
      options.storeSettingsStore ??
      new JsonStore(harnessStoreSettingsPath(), DEFAULT_STORE_SETTINGS)

    this.policy =
      options.policy ??
      new PolicyEngine(
        options.policyStore ??
          new JsonStore(harnessPolicyPath(), structuredClone(DEFAULT_POLICY_CONFIG))
      )

    const readEntries = (sessionId: string): Promise<SessionEntry[]> =>
      options.sessions ? options.sessions.readRawEntries(sessionId) : Promise.resolve([])

    this.runs = new RunRegistry({
      emit: (sessionId, event) => this.emit(sessionId, event),
      getBudget: () => this.policy.budget(),
      getEntries: options.sessions ? readEntries : undefined,
      getHarnessState: (sessionId) => this.adapter.getState(sessionId),
      getLastAssistantText: (sessionId) => this.lastAssistantText(sessionId),
      getCwd: (sessionId) => this.sessionCwd(sessionId),
      listPersistedRuns: async (sessionId) => this.runRepository.listBySession(sessionId),
      onBudgetExceeded: async (sessionId) => {
        await this.abort(sessionId)
      },
      onRunSettled: (run) => this.handleRunSettled(run),
      onRunFinalized: (run) => this.handleRunFinalized(run)
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
    this.runRepository = new JsonRunRepository(runStore)
    this.trace = new TraceService({
      repository: new JsonTraceRepository(traceStore),
      maxEventsPerRun: this.storeSettings.peek().maxEventsPerRun
    })
    this.evaluation = new EvaluationService(
      {
        getEntries: readEntries,
        getGitStatus: (sessionId) => this.gitStatusForSession(sessionId)
      },
      evaluationStore
    )
    this.artifacts = new ArtifactService(artifactStore, {
      getEntries: readEntries,
      getCheckpoints: (sessionId) => this.checkpoints.list(sessionId),
      getGitCommits: (cwd, since, until) => this.gitCommitsFor(cwd, since, until),
      emit: (sessionId, event) => this.emit(sessionId, event)
    })
    this.replay = new ReplayService(this.trace, { getEntries: readEntries })
    this.regression = new RegressionService(baselineStore)
    this.diagnosticsService = new DiagnosticsService()
    this.exportService = new RunExportService({
      appVersion: options.appVersion ?? 'unknown',
      piVersion: options.piVersion ?? null,
      platform: `${os.platform()}-${os.arch()}`,
      nodeVersion: process.versions.node
    })
    if (options.git) this.git = options.git
    if (options.sessions) this.sessions = options.sessions
    void this.applyRetention()
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

  /** Run lookup by id across live + persisted runs (multi-agent orchestration). */
  async getRunById(runId: string): Promise<import('@shared/types/harness').HarnessRun | null> {
    const live = this.runs.listAllLiveRuns().find((run) => run.id === runId)
    if (live) return live
    return this.runRepository.get(runId)
  }

  /** All runs bound to an orchestration (live + persisted). */
  async listRunsByOrchestration(
    orchestrationId: string
  ): Promise<import('@shared/types/harness').HarnessRun[]> {
    const persisted = await this.runRepository.listByOrchestration(orchestrationId)
    const live = this.runs
      .listAllLiveRuns()
      .filter((run) => run.orchestrationId === orchestrationId)
    const seen = new Set(persisted.map((run) => run.id))
    return [...persisted, ...live.filter((run) => !seen.has(run.id))]
  }

  // ------------------------------------------------------------- run surface

  async listRuns(
    sessionId: string,
    scope: 'session' | 'project' = 'session'
  ): Promise<HarnessRun[]> {
    if (scope === 'project') {
      const cwd = await this.sessionCwd(sessionId)
      if (!cwd) return this.runs.listRuns(sessionId)
      const persisted = await this.runRepository.listByCwd(cwd)
      const live = (await this.runs.listRuns(sessionId)).filter(
        (run) => run.cwd === null || run.cwd === cwd
      )
      const seen = new Set<string>()
      return [...live, ...persisted]
        .filter((run) => (seen.has(run.id) ? false : seen.add(run.id)))
        .sort((a, b) => b.startedAt - a.startedAt)
    }
    return this.runs.listRuns(sessionId)
  }

  async getRun(sessionId: string, runId: string): Promise<HarnessRun> {
    const run = await this.findRun(sessionId, runId)
    if (!run) {
      throw new HarnessError('RUN_NOT_FOUND', `Run not found: ${runId}`, { sessionId, runId })
    }
    return run
  }

  /** Session runs first, then the persisted repository (cross-session). */
  private async findRun(sessionId: string, runId: string): Promise<HarnessRun | null> {
    const run = await this.runs.getRun(sessionId, runId)
    if (run) return run
    return this.runRepository.get(runId)
  }

  /** Full run dossier: replay trace, evaluation, artifacts, diagnostics, regression. */
  async getRunDetail(sessionId: string, runId: string): Promise<HarnessRunDetail> {
    const run = await this.getRun(sessionId, runId)
    const trace = await this.replay.buildReplay(run)
    const evaluation = await this.evaluation.get(run.sessionId, run.id)
    const artifacts = await this.artifacts.list(run.sessionId, run.id)
    const diagnostics = this.diagnosticsService.diagnose(run, trace, evaluation)
    const regression = await this.regressionReport(run)
    const baselineTokens = regression
      ? ((await this.findRun(sessionId, regression.baseline.runId))?.usage.totalTokens ?? null)
      : null
    const deltaPercent =
      baselineTokens && baselineTokens > 0
        ? ((run.usage.totalTokens - baselineTokens) / baselineTokens) * 100
        : null
    const insights = buildInsights(
      run,
      trace,
      deltaPercent !== null ? { percent: deltaPercent } : null
    )
    return {
      run,
      trace,
      evaluation,
      artifacts,
      diagnostics,
      insights,
      regression
    }
  }

  /** Run lineage tree (forks, retries, recoveries) for the session. */
  async getRunTree(sessionId: string): Promise<HarnessRunTreeNode[]> {
    const runs = await this.runs.listRuns(sessionId)
    return buildRunTree(runs)
  }

  /** Side-by-side comparison of two runs: metrics + real diffs. */
  async compareRuns(
    sessionId: string,
    runIdA: string,
    runIdB: string
  ): Promise<HarnessRunComparison> {
    const [runA, runB] = await Promise.all([
      this.getRun(sessionId, runIdA),
      this.getRun(sessionId, runIdB)
    ])
    const [evaluationA, evaluationB, artifactsA, artifactsB] = await Promise.all([
      this.evaluation.get(runA.sessionId, runA.id),
      this.evaluation.get(runB.sessionId, runB.id),
      this.artifacts.list(runA.sessionId, runA.id),
      this.artifacts.list(runB.sessionId, runB.id)
    ])
    const comparison = compareRuns({
      runA,
      runB,
      evaluationA,
      evaluationB,
      artifactsA,
      artifactsB
    })
    // Regression findings vs each other sharpen the comparison.
    const evaluations = new Map<string, HarnessEvaluation>()
    if (evaluationA) evaluations.set(runA.id, evaluationA)
    if (evaluationB) evaluations.set(runB.id, evaluationB)
    comparison.findings = [
      ...this.regression.compare(runB, runA, evaluations),
      ...this.regression.compare(runA, runB, evaluations)
    ]
    return comparison
  }

  /**
   * Fork & re-run. Fork creates a new session at the run's anchor entry (or a
   * checkpoint / trace-event point) and re-sends the prompt; re-run re-sends
   * the prompt in the same session.
   */
  async forkRun(
    sessionId: string,
    runId: string,
    options: {
      mode?: 'fork' | 'rerun'
      fromEventId?: string
      fromCheckpointId?: string
      message?: string
    } = {}
  ): Promise<{ forked: boolean; newSessionId: string | null; newRunId: string | null }> {
    const run = await this.getRun(sessionId, runId)
    const message = options.message?.trim() || run.prompt
    const mode = options.mode ?? 'fork'
    const forkedFromEventId = options.fromEventId ?? null
    const forkedFromCheckpointId = options.fromCheckpointId ?? null

    if (mode === 'rerun') {
      this.runs.annotateNextRun(sessionId, {
        relation: 'rerun',
        forkedFromRunId: run.id,
        forkedFromEventId,
        forkedFromCheckpointId
      })
      await this.prompt(sessionId, message)
      this.emit(sessionId, {
        type: 'run.forked',
        timestamp: Date.now(),
        runId: run.id,
        newSessionId: sessionId
      })
      return { forked: true, newSessionId: sessionId, newRunId: null }
    }

    const entryId = await this.resolveForkEntryId(
      sessionId,
      run,
      forkedFromEventId,
      forkedFromCheckpointId
    )
    if (!entryId) {
      throw new HarnessError('FORK_FAILED', 'Run has no session entry to fork from.', {
        sessionId,
        runId
      })
    }
    const result = await this.fork(sessionId, entryId)
    if (result.cancelled || !result.newSessionId) {
      return { forked: false, newSessionId: null, newRunId: null }
    }
    this.runs.annotateNextRun(result.newSessionId, {
      relation: 'fork',
      forkedFromRunId: run.id,
      forkedFromEventId,
      forkedFromCheckpointId
    })
    this.emit(sessionId, {
      type: 'run.forked',
      timestamp: Date.now(),
      runId: run.id,
      newSessionId: result.newSessionId
    })
    await this.prompt(result.newSessionId, message)
    return { forked: true, newSessionId: result.newSessionId, newRunId: null }
  }

  /** Map a fork request onto a real session entry id. */
  private async resolveForkEntryId(
    sessionId: string,
    run: HarnessRun,
    fromEventId: string | null,
    fromCheckpointId: string | null
  ): Promise<string | null> {
    if (fromCheckpointId) {
      const checkpoint = await this.checkpoints.get(fromCheckpointId)
      if (checkpoint) return checkpoint.sessionEntryId
    }
    if (fromEventId && this.sessions) {
      // Trace event → the latest session entry at or before that event.
      const trace = await this.replay.buildReplay(run)
      const event = trace?.events.find((item) => item.id === fromEventId)
      if (event) {
        try {
          const entries = await this.sessions.readRawEntries(run.sessionId)
          let match: string | null = null
          for (const entry of entries) {
            const timestamp = Date.parse(entry.timestamp)
            if (Number.isFinite(timestamp) && timestamp <= event.event.timestamp) {
              match = entry.id
            }
          }
          if (match) return match
        } catch {
          /* fall back to the run anchor */
        }
      }
    }
    return run.anchorEntryId
  }

  // --------------------------------------------------------- artifact surface

  async listArtifacts(sessionId: string, runId?: string): Promise<HarnessArtifact[]> {
    return this.artifacts.list(sessionId, runId)
  }

  // --------------------------------------------------------- baseline surface

  async getBaseline(sessionId: string): Promise<HarnessBaseline | null> {
    const cwd = await this.sessionCwd(sessionId)
    if (!cwd) return null
    return this.regression.getBaseline(cwd)
  }

  async setBaseline(sessionId: string, runId: string): Promise<HarnessBaseline> {
    const run = await this.getRun(sessionId, runId)
    const cwd = run.cwd ?? (await this.sessionCwd(sessionId))
    if (!cwd) {
      throw new HarnessError('RUN_NOT_FOUND', 'Run has no project directory.', { sessionId, runId })
    }
    const baseline = await this.regression.setBaseline(run, cwd)
    this.emit(sessionId, {
      type: 'baseline.changed',
      timestamp: Date.now(),
      cwd,
      runId: run.id
    })
    return baseline
  }

  private async regressionReport(run: HarnessRun): Promise<HarnessRegressionReport | null> {
    const cwd = run.cwd
    if (!cwd) return null
    const baseline = await this.regression.getBaseline(cwd)
    if (!baseline || baseline.runId === run.id) return null
    const baselineRun = await this.runRepository.get(baseline.runId)
    if (!baselineRun) return null
    const evaluations = await this.evaluation.listByRunIds([run.id, baselineRun.id])
    const findings = this.regression.compare(run, baselineRun, evaluations)
    return { baseline, findings, comparedAt: Date.now() }
  }

  // ------------------------------------------------------- project statistics

  async getProjectStats(sessionId: string, range: HarnessStatsRange): Promise<HarnessProjectStats> {
    const cwd = await this.sessionCwd(sessionId)
    const now = Date.now()
    const rangeStart =
      range === 'today'
        ? startOfToday(now)
        : range === '7d'
          ? now - 7 * 86_400_000
          : range === '30d'
            ? now - 30 * 86_400_000
            : 0
    const runs = cwd
      ? (await this.runRepository.listByCwd(cwd)).filter((run) => run.startedAt >= rangeStart)
      : []
    const sessionIds = new Set(runs.map((run) => run.sessionId))
    const total = runs.length
    const succeeded = runs.filter((run) => run.status === 'success').length
    const failed = runs.filter((run) => run.status === 'failed' || run.status === 'aborted').length
    const durations = runs
      .map((run) => (run.finishedAt ? run.finishedAt - run.startedAt : null))
      .filter((value): value is number => value !== null)
    const evaluations = await this.evaluation.listByRunIds(runs.map((run) => run.id))
    const evaluated = [...evaluations.values()]
    const passed = evaluated.filter((evaluation) => evaluation.status === 'passed').length
    const recoveries = runs.filter((run) => run.relation === 'recovery').length
    const toolCalls = runs.reduce((sum, run) => sum + run.toolCallCount, 0)
    return {
      cwd,
      range,
      sessionCount: sessionIds.size,
      totalRuns: total,
      successRate: total ? round(succeeded / total) : null,
      failureRate: total ? round(failed / total) : null,
      averageDurationMs: durations.length
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : null,
      averageTokens: total
        ? Math.round(runs.reduce((sum, run) => sum + run.usage.totalTokens, 0) / total)
        : null,
      averageCost: (() => {
        const costs = runs
          .map((run) => run.usage.estimatedCost)
          .filter((value): value is number => value !== null)
        return costs.length
          ? Number((costs.reduce((sum, value) => sum + value, 0) / costs.length).toFixed(4))
          : null
      })(),
      toolFailureRate: toolCalls
        ? round(runs.reduce((sum, run) => sum + run.toolFailureCount, 0) / toolCalls)
        : null,
      evaluationPassRate: evaluated.length ? round(passed / evaluated.length) : null,
      recoveryRate: total ? round(recoveries / total) : null,
      topFailureReasons: this.diagnosticsService.aggregate(
        runs.filter((run) => run.status === 'failed' || run.status === 'aborted')
      )
    }
  }

  // ------------------------------------------------------------ export surface

  async exportRun(
    sessionId: string,
    runId: string,
    format: 'json' | 'markdown'
  ): Promise<HarnessExportResult> {
    const detail = await this.getRunDetail(sessionId, runId)
    return this.exportService.exportRun(detail, format, detail.run.prompt.slice(0, 40))
  }

  async exportDebugBundle(sessionId: string, runId?: string): Promise<HarnessExportResult> {
    const payload = runId ? await this.getRunDetail(sessionId, runId) : null
    return this.exportService.exportDebugBundle(payload)
  }

  // --------------------------------------------------------- retention settings

  async getStoreSettings(): Promise<HarnessStoreSettings> {
    return this.storeSettings.read()
  }

  async updateStoreSettings(settings: HarnessStoreSettings): Promise<HarnessStoreSettings> {
    await this.storeSettings.write(settings)
    await this.applyRetention()
    return settings
  }

  private async applyRetention(): Promise<void> {
    try {
      const settings = await this.storeSettings.read()
      if (settings.retentionDays > 0) {
        const now = Date.now()
        await this.runRepository.prune(now, settings.retentionDays)
        await this.trace.repository.prune(now, settings.retentionDays)
      }
    } catch (error) {
      log.harness.warn('retention sweep failed:', error)
    }
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
    const checkpoint = await this.checkpoints.get(checkpointId)
    if (checkpoint) {
      this.runs.annotateNextRun(checkpoint.sessionId, {
        relation: 'recovery',
        forkedFromCheckpointId: checkpoint.id
      })
    }
    return this.checkpoints.resume(checkpointId, message)
  }

  async forkCheckpoint(checkpointId: string): Promise<HarnessForkResult> {
    const checkpoint = await this.checkpoints.get(checkpointId)
    const result = await this.checkpoints.fork(checkpointId)
    if (checkpoint && !result.cancelled) {
      this.runs.annotateNextRun(checkpoint.sessionId, {
        relation: 'fork',
        forkedFromCheckpointId: checkpoint.id
      })
    }
    return result
  }

  async retryLastRun(sessionId: string): Promise<{ retried: boolean; prompt: string | null }> {
    this.runs.annotateNextRun(sessionId, { relation: 'retry' })
    return this.checkpoints.retryLastRun(sessionId)
  }

  // ------------------------------------------------------ evaluation surface

  async listEvaluations(sessionId: string): Promise<HarnessEvaluation[]> {
    return this.evaluation.list(sessionId)
  }

  async evaluateRun(sessionId: string, runId: string): Promise<HarnessEvaluation> {
    const run = await this.getRun(sessionId, runId)
    const inProgress: HarnessRunStatus[] = [
      'queued',
      'running',
      'waiting',
      'tool-calling',
      'verifying'
    ]
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
      const evaluation = await this.evaluation.evaluate(run.sessionId, run, {
        preset: this.policy.evaluationPreset(),
        customStages: this.policy.customEvaluationStages()
      })
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

  /**
   * The run reached its final verdict: persist it, close its trace frame and
   * collect artifacts from real evidence.
   */
  private async handleRunFinalized(run: HarnessRun): Promise<void> {
    await this.trace.captureRun(run)
    await this.runRepository.save(run)
    await this.artifacts.collectForRun(run)
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

  /** Commits that landed inside a run window (git-commit artifacts). */
  private async gitCommitsFor(
    cwd: string,
    since: number,
    until: number
  ): Promise<Array<{ hash: string; subject: string; timestamp: number }>> {
    if (!this.git) return []
    try {
      const history = await this.git.history(cwd, 50)
      return history
        .map((commit) => ({
          hash: commit.hash,
          subject: commit.subject,
          timestamp: Date.parse(commit.authoredAt)
        }))
        .filter(
          (commit) =>
            Number.isFinite(commit.timestamp) &&
            commit.timestamp >= since &&
            commit.timestamp <= until
        )
    } catch {
      return []
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
    // Trace reduction runs last so derived run events (run.started → frame
    // open, run.completed → frame close) frame every observed event.
    this.trace.observe(sessionId, event)
  }

  /**
   * Deliver an orchestration-scoped event to listeners and the renderer.
   * Orchestration ids are not Pi sessions: no run reduction, no trace
   * frames — only the unified event stream is extended.
   */
  emitOrchestration(orchestrationId: string, event: HarnessEvent): void {
    const timeline = this.timelines.get(orchestrationId) ?? []
    const next = [...timeline, event].slice(-200)
    this.timelines.set(orchestrationId, next)
    const payload = { sessionId: orchestrationId, event }
    for (const listener of this.listeners) {
      try {
        listener(payload)
      } catch (error) {
        log.agent.error('failed to deliver orchestration event:', error)
      }
    }
    const win = this.getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    try {
      win.webContents.send(IPC_EVENT.harnessEvent, payload)
    } catch (error) {
      log.agent.error('failed to send orchestration event:', error)
    }
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

function startOfToday(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Percentage rounded to two decimals. */
function round(value: number): number {
  return Math.round(value * 10000) / 100
}

function isCompactionResult(value: unknown): value is HarnessCompactionResult {
  return typeof value === 'object' && value !== null && 'cancelled' in value
}
