/**
 * Harness Control Plane facade (runtime port of Electron `HarnessRuntime`
 * control-plane surface).
 *
 * Observes the Harness event stream, reduces Runs / traces, and exposes
 * Runs, Checkpoints, Policy, Evaluation, Artifacts, Baseline, Compare,
 * Project Stats and export. Pi remains the only Agent Runtime.
 */

import os from 'node:os'
import { JsonStore } from '../support/json-store.js'
import { gitHeadInfo, gitHistory, gitStatus } from '../support/git-lite.js'
import { log } from '../support/runtime-log.js'
import type { SessionEntry } from '../types.js'
import type { AgentRuntimeManager } from '../agent/manager.js'
import type { HarnessService } from '../harness/service.js'
import type { SessionService } from '../session/service.js'
import type { AgentSessionLike } from '../pi/types.js'
import { wrapPolicyGuardedTools } from './policy/policy-tool-guard.js'
import { PolicyEngine } from './policy/policy-engine.js'
import { DEFAULT_POLICY_CONFIG } from './policy/policy-defaults.js'
import { RunRegistry, type RunRelationAnnotation } from './runs/run-registry.js'
import {
  JsonRunRepository,
  buildRunTree,
  type RunRepository,
  type RunStoreRecord
} from './runs/run-repository.js'
import {
  CheckpointService,
  EMPTY_CHECKPOINT_STORE,
  type CheckpointStoreRecord
} from './checkpoints/service.js'
import {
  EMPTY_EVALUATION_STORE,
  EvaluationService,
  type EvaluationStoreRecord
} from './evaluations/service.js'
import {
  EMPTY_ARTIFACT_STORE,
  ArtifactService,
  type ArtifactStoreRecord
} from './artifacts/service.js'
import { EMPTY_TRACE_STORE, JsonTraceRepository, type TraceStoreRecord } from './trace/repository.js'
import { TraceService } from './trace/service.js'
import { ReplayService } from './replay/service.js'
import { EMPTY_BASELINE_STORE, RegressionService, type BaselineStoreRecord } from './regression/service.js'
import { DiagnosticsService, buildInsights } from './diagnostics/service.js'
import { compareRuns } from './compare/service.js'
import { RunExportService } from './export/service.js'
import { HarnessError } from './harness-error.js'
import {
  harnessArtifactsPath,
  harnessBaselinesPath,
  harnessCheckpointsPath,
  harnessEvaluationsPath,
  harnessPolicyPath,
  harnessRunsPath,
  harnessStoreSettingsPath,
  harnessTracesPath
} from './paths.js'
import type {
  HarnessBaseline,
  HarnessCheckpoint,
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
  HarnessStatsRange,
  HarnessStoreSettings
} from './types.js'

export const DEFAULT_STORE_SETTINGS: HarnessStoreSettings = {
  schemaVersion: 1,
  retentionDays: 30,
  maxEventsPerRun: 400
}

type HarnessEventListener = (payload: HarnessEventEnvelope) => void

export interface ControlPlaneDeps {
  harness: HarnessService
  sessions: SessionService
  agent: AgentRuntimeManager
  appVersion?: string
  piVersion?: string | null
}

export class ControlPlaneService {
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
  private readonly listeners = new Set<HarnessEventListener>()
  private readonly wrappedSessions = new Set<string>()

  constructor(private readonly deps: ControlPlaneDeps) {
    const runStore = new JsonStore<RunStoreRecord>(harnessRunsPath(), { schemaVersion: 1, runs: [] })
    const traceStore = new JsonStore<TraceStoreRecord>(harnessTracesPath(), EMPTY_TRACE_STORE)
    const artifactStore = new JsonStore<ArtifactStoreRecord>(
      harnessArtifactsPath(),
      EMPTY_ARTIFACT_STORE
    )
    const evaluationStore = new JsonStore<EvaluationStoreRecord>(
      harnessEvaluationsPath(),
      EMPTY_EVALUATION_STORE
    )
    const baselineStore = new JsonStore<BaselineStoreRecord>(
      harnessBaselinesPath(),
      EMPTY_BASELINE_STORE
    )
    this.storeSettings = new JsonStore(harnessStoreSettingsPath(), DEFAULT_STORE_SETTINGS)
    this.policy = new PolicyEngine(
      new JsonStore(harnessPolicyPath(), structuredClone(DEFAULT_POLICY_CONFIG))
    )
    this.policy.onDecision((report) => this.recordPolicyDecision(report.sessionId, report))

    const readEntries = (sessionId: string): Promise<SessionEntry[]> =>
      this.deps.sessions.readRawEntries(sessionId).catch(() => [])

    this.runRepository = new JsonRunRepository(runStore)
    this.runs = new RunRegistry({
      emit: (sessionId, event) => this.deps.harness.emitEvent(sessionId, event),
      getBudget: () => this.policy.budget(),
      getEntries: readEntries,
      getHarnessState: (sessionId) => this.deps.harness.getState(sessionId),
      getLastAssistantText: (sessionId) => this.lastAssistantText(sessionId),
      getCwd: (sessionId) => this.sessionCwd(sessionId),
      listPersistedRuns: async (sessionId) => this.runRepository.listBySession(sessionId),
      onBudgetExceeded: async (sessionId) => {
        await this.deps.harness.abort(sessionId)
      },
      onRunSettled: (run) => this.handleRunSettled(run),
      onRunFinalized: (run) => this.handleRunFinalized(run)
    })
    this.checkpoints = new CheckpointService(
      new JsonStore<CheckpointStoreRecord>(harnessCheckpointsPath(), EMPTY_CHECKPOINT_STORE),
      {
        getSessionState: (sessionId) => this.checkpointSessionState(sessionId),
        getGitState: async (cwd) => (cwd ? gitHeadInfo(cwd) : null),
        getContextState: async (sessionId) => {
          try {
            const state = await this.deps.harness.getState(sessionId)
            return state?.context
              ? { percent: state.context.percent, tokens: state.context.tokens }
              : null
          } catch {
            return null
          }
        },
        navigateTree: (sessionId, entryId) => this.deps.harness.navigateTree(sessionId, entryId),
        fork: (sessionId, entryId) => this.deps.harness.fork(sessionId, entryId),
        prompt: (sessionId, message) => this.deps.harness.prompt(sessionId, message),
        getLastRetryablePrompt: (sessionId) => this.lastRetryablePrompt(sessionId),
        emit: (sessionId, event) => this.deps.harness.emitEvent(sessionId, event),
        attachToRun: (sessionId, checkpointId, runId) =>
          this.runs.attachCheckpoint(sessionId, checkpointId, runId)
      }
    )
    this.trace = new TraceService({
      repository: new JsonTraceRepository(traceStore),
      maxEventsPerRun: this.storeSettings.peek().maxEventsPerRun
    })
    this.evaluation = new EvaluationService(
      {
        getEntries: readEntries,
        getGitStatus: async (sessionId) => {
          const cwd = await this.sessionCwd(sessionId)
          return cwd ? gitStatus(cwd) : null
        }
      },
      evaluationStore
    )
    this.artifacts = new ArtifactService(artifactStore, {
      getEntries: readEntries,
      getCheckpoints: (sessionId) => this.checkpoints.list(sessionId),
      getGitCommits: (cwd, since, until) =>
        gitHistory(cwd, 50).then((commits) =>
          commits.filter((commit) => commit.timestamp >= since && commit.timestamp <= until)
        ),
      emit: (sessionId, event) => this.deps.harness.emitEvent(sessionId, event)
    })
    this.replay = new ReplayService(this.trace, { getEntries: readEntries })
    this.regression = new RegressionService(baselineStore)
    this.diagnosticsService = new DiagnosticsService()
    this.exportService = new RunExportService({
      appVersion: deps.appVersion ?? process.env.npm_package_version ?? '1.6.0',
      piVersion: deps.piVersion ?? null,
      platform: `${os.platform()}-${os.arch()}`,
      nodeVersion: process.versions.node
    })
    void this.applyRetention()
  }

  onEvent(listener: HarnessEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Observe a Harness event already delivered to the UI sink. */
  observe(sessionId: string, event: HarnessEvent): void {
    for (const listener of this.listeners) {
      try {
        listener({ sessionId, event })
      } catch (error) {
        log.harness.warn('control-plane listener failed:', error)
      }
    }
    this.runs.handleEvent(sessionId, event)
    this.trace.observe(sessionId, event)
    if (event.type === 'prompt.started') {
      void this.autoPreRunCheckpoint(sessionId)
    }
  }

  wrapSessionTools(session: AgentSessionLike, sessionId: string): void {
    if (this.wrappedSessions.has(sessionId)) return
    this.wrappedSessions.add(sessionId)
    wrapPolicyGuardedTools(session, this.policy, {
      sessionId,
      report: (payload) =>
        this.recordPolicyDecision(sessionId, { sessionId, ...payload })
    })
  }

  annotateNextRun(sessionId: string, annotation: RunRelationAnnotation): void {
    this.runs.annotateNextRun(sessionId, annotation)
  }

  async getRunById(runId: string): Promise<HarnessRun | null> {
    const live = this.runs.listAllLiveRuns().find((run) => run.id === runId)
    if (live) return live
    return this.runRepository.get(runId)
  }

  async listRunsByOrchestration(orchestrationId: string): Promise<HarnessRun[]> {
    const persisted = await this.runRepository.listByOrchestration(orchestrationId)
    const live = this.runs
      .listAllLiveRuns()
      .filter((run) => run.orchestrationId === orchestrationId)
    const seen = new Set(persisted.map((run) => run.id))
    return [...persisted, ...live.filter((run) => !seen.has(run.id))]
  }

  async listRuns(sessionId: string, scope: 'session' | 'project' = 'session'): Promise<HarnessRun[]> {
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

  async getRunDetail(sessionId: string, runId: string): Promise<HarnessRunDetail> {
    const run = await this.getRun(sessionId, runId)
    const trace = await this.replay.buildReplay(run)
    const evaluation = await this.evaluation.get(run.sessionId, run.id)
    const artifacts = await this.artifacts.list(run.sessionId, run.id)
    const diagnostics = this.diagnosticsService.diagnose(run, trace, evaluation)
    const regression = await this.regressionReport(run)
    const baselineTokens = regression
      ? (await this.findRun(sessionId, regression.baseline.runId))?.usage.totalTokens ?? null
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
    return { run, trace, evaluation, artifacts, diagnostics, insights, regression }
  }

  async getRunTree(sessionId: string): Promise<HarnessRunTreeNode[]> {
    return buildRunTree(await this.runs.listRuns(sessionId))
  }

  async compareRuns(sessionId: string, runIdA: string, runIdB: string): Promise<HarnessRunComparison> {
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
    const evaluations = new Map<string, HarnessEvaluation>()
    if (evaluationA) evaluations.set(runA.id, evaluationA)
    if (evaluationB) evaluations.set(runB.id, evaluationB)
    comparison.findings = [
      ...this.regression.compare(runB, runA, evaluations),
      ...this.regression.compare(runA, runB, evaluations)
    ]
    return comparison
  }

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
      await this.deps.harness.prompt(sessionId, message)
      this.deps.harness.emitEvent(sessionId, {
        type: 'run.forked',
        timestamp: Date.now(),
        runId: run.id,
        newSessionId: sessionId
      })
      return { forked: true, newSessionId: sessionId, newRunId: null }
    }

    const entryId = await this.resolveForkEntryId(sessionId, run, forkedFromEventId, forkedFromCheckpointId)
    if (!entryId) {
      throw new HarnessError('FORK_FAILED', 'Run has no session entry to fork from.', {
        sessionId,
        runId
      })
    }
    const result = await this.deps.harness.fork(sessionId, entryId)
    if (result.cancelled || !result.newSessionId) {
      return { forked: false, newSessionId: null, newRunId: null }
    }
    this.runs.annotateNextRun(result.newSessionId, {
      relation: 'fork',
      forkedFromRunId: run.id,
      forkedFromEventId,
      forkedFromCheckpointId
    })
    this.deps.harness.emitEvent(sessionId, {
      type: 'run.forked',
      timestamp: Date.now(),
      runId: run.id,
      newSessionId: result.newSessionId
    })
    await this.deps.harness.prompt(result.newSessionId, message)
    return { forked: true, newSessionId: result.newSessionId, newRunId: null }
  }

  async listArtifacts(sessionId: string, runId?: string): Promise<import('./types.js').HarnessArtifact[]> {
    return this.artifacts.list(sessionId, runId)
  }

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
    this.deps.harness.emitEvent(sessionId, {
      type: 'baseline.changed',
      timestamp: Date.now(),
      cwd,
      runId: run.id
    })
    return baseline
  }

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

  async getStoreSettings(): Promise<HarnessStoreSettings> {
    return this.storeSettings.read()
  }

  async updateStoreSettings(settings: HarnessStoreSettings): Promise<HarnessStoreSettings> {
    await this.storeSettings.write(settings)
    await this.applyRetention()
    return settings
  }

  async getPolicySnapshot(): Promise<HarnessPolicySnapshot> {
    return this.policy.snapshot()
  }

  async updatePolicy(config: HarnessPolicyConfig): Promise<HarnessPolicySnapshot> {
    return this.policy.update(config)
  }

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
    this.deps.harness.emitEvent(sessionId, {
      type: 'evaluation.started',
      timestamp: Date.now(),
      runId
    })
    const evaluation = await this.evaluation.evaluate(sessionId, run)
    this.deps.harness.emitEvent(sessionId, {
      type: 'evaluation.completed',
      timestamp: Date.now(),
      runId,
      status: evaluation.status
    })
    return evaluation
  }

  private recordPolicyDecision(sessionId: string, report: HarnessPolicyDecisionReport): void {
    if (report.decision === 'ask') {
      this.deps.harness.emitEvent(sessionId, {
        type: 'policy.confirmed',
        timestamp: Date.now(),
        domain: report.domain,
        target: report.target,
        allowed: report.allowed
      })
      return
    }
    this.deps.harness.emitEvent(sessionId, {
      type: report.decision === 'deny' || !report.allowed ? 'policy.denied' : 'policy.allowed',
      timestamp: Date.now(),
      domain: report.domain,
      target: report.target,
      rule: report.rule
    })
  }

  private async handleRunSettled(run: HarnessRun): Promise<void> {
    if (!this.policy.autoEvaluate()) return
    this.runs.markEvaluating(run.sessionId, run.id)
    this.deps.harness.emitEvent(run.sessionId, {
      type: 'evaluation.started',
      timestamp: Date.now(),
      runId: run.id
    })
    try {
      const evaluation = await this.evaluation.evaluate(run.sessionId, run, {
        preset: this.policy.evaluationPreset(),
        customStages: this.policy.customEvaluationStages()
      })
      this.deps.harness.emitEvent(run.sessionId, {
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

  private async findRun(sessionId: string, runId: string): Promise<HarnessRun | null> {
    return (await this.runs.getRun(sessionId, runId)) ?? this.runRepository.get(runId)
  }

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
    if (fromEventId) {
      const trace = await this.replay.buildReplay(run)
      const event = trace?.events.find((item) => item.id === fromEventId)
      if (event) {
        try {
          const entries = await this.deps.sessions.readRawEntries(run.sessionId)
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

  private async regressionReport(run: HarnessRun): Promise<HarnessRegressionReport | null> {
    const cwd = run.cwd
    if (!cwd) return null
    const baseline = await this.regression.getBaseline(cwd)
    if (!baseline || baseline.runId === run.id) return null
    const baselineRun = await this.runRepository.get(baseline.runId)
    if (!baselineRun) return null
    const evaluations = await this.evaluation.listByRunIds([run.id, baselineRun.id])
    return {
      baseline,
      findings: this.regression.compare(run, baselineRun, evaluations),
      comparedAt: Date.now()
    }
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

  private async checkpointSessionState(sessionId: string): Promise<{
    leafId: string | null
    cwd: string | null
  }> {
    let leafId: string | null = null
    try {
      leafId = (await this.deps.harness.getSession(sessionId)).leafId
    } catch {
      /* fall back to persisted session */
    }
    if (!leafId) {
      try {
        leafId = (await this.deps.sessions.get(sessionId)).leafId
      } catch {
        /* none */
      }
    }
    return { leafId, cwd: await this.sessionCwd(sessionId) }
  }

  private async sessionCwd(sessionId: string): Promise<string | null> {
    try {
      const sessions = await this.deps.sessions.list()
      return sessions.find((session) => session.id === sessionId)?.cwd ?? null
    } catch {
      return null
    }
  }

  private async lastAssistantText(sessionId: string): Promise<string | null> {
    const entries = await this.deps.sessions.readRawEntries(sessionId).catch(() => [])
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (!entry || entry.type !== 'message') continue
      const message = entry.message as { role?: string; content?: unknown } | undefined
      if (message?.role !== 'assistant') continue
      const text = extractText(message.content)
      if (text.trim()) return text
    }
    return null
  }

  private async lastRetryablePrompt(sessionId: string): Promise<string | null> {
    const runs = await this.runs.listRuns(sessionId)
    return (
      runs.find((run) => (run.status === 'failed' || run.status === 'aborted') && run.prompt.trim())
        ?.prompt ?? null
    )
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        Boolean(block) &&
        typeof block === 'object' &&
        (block as { type?: string }).type === 'text' &&
        typeof (block as { text?: string }).text === 'string'
    )
    .map((block) => block.text)
    .join('\n')
}

function startOfToday(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function round(value: number): number {
  return Number(value.toFixed(4))
}
