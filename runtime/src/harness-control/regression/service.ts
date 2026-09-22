/**
 * Regression Detection.
 *
 * Deterministic rules comparing the current run against a baseline, the
 * previous run, or a selected run. First version: fixed thresholds, no
 * statistics, no LLM.
 */

import type { JsonStore } from '../../support/json-store.js'
import type {
  HarnessEvaluation,
  HarnessRegressionFinding,
  HarnessRegressionMetric,
  HarnessRegressionSeverity,
  HarnessBaseline,
  HarnessRun
} from '../types.js'

export interface BaselineStoreRecord {
  schemaVersion: 1
  /** cwd → baseline */
  baselines: Record<string, HarnessBaseline>
}

export const EMPTY_BASELINE_STORE: BaselineStoreRecord = { schemaVersion: 1, baselines: {} }

// Thresholds (percent) — deliberately simple and predictable.
const WARNING_THRESHOLD = 25
const REGRESSION_THRESHOLD = 50
const DURATION_WARNING_THRESHOLD = 50
const DURATION_REGRESSION_THRESHOLD = 100
const IMPROVEMENT_THRESHOLD = 25

export class RegressionService {
  constructor(private readonly store: JsonStore<BaselineStoreRecord>) {}

  async getBaseline(cwd: string): Promise<HarnessBaseline | null> {
    const record = await this.store.read()
    return record.baselines[cwd] ?? null
  }

  async setBaseline(run: HarnessRun, cwd: string): Promise<HarnessBaseline> {
    const baseline: HarnessBaseline = {
      cwd,
      sessionId: run.sessionId,
      runId: run.id,
      runLabel: run.prompt.slice(0, 80),
      setAt: Date.now()
    }
    const record = await this.store.read()
    await this.store.write({
      schemaVersion: 1,
      baselines: { ...record.baselines, [cwd]: baseline }
    })
    return baseline
  }

  /** Compare a run against a baseline/previous/selected run. */
  compare(
    current: HarnessRun,
    baseline: HarnessRun,
    evaluations: ReadonlyMap<string, HarnessEvaluation>
  ): HarnessRegressionFinding[] {
    const findings: HarnessRegressionFinding[] = []
    findings.push(...metricFinding(current, baseline, 'tokens', current.usage.totalTokens, baseline.usage.totalTokens, '{a} tokens → {b} tokens'))
    const currentCost = current.usage.estimatedCost
    const baselineCost = baseline.usage.estimatedCost
    if (currentCost !== null && baselineCost !== null) {
      findings.push(
        ...metricFinding(current, baseline, 'cost', currentCost, baselineCost, '${a} → ${b}')
      )
    }
    const currentDuration = current.finishedAt ? current.finishedAt - current.startedAt : null
    const baselineDuration = baseline.finishedAt ? baseline.finishedAt - baseline.startedAt : null
    if (currentDuration !== null && baselineDuration !== null && baselineDuration > 0) {
      findings.push(
        ...durationFinding(current, baseline, currentDuration, baselineDuration)
      )
    }
    findings.push(
      ...toolFailureFinding(current, baseline),
      ...toolCallFinding(current, baseline),
      ...evaluationFinding(current, baseline, evaluations)
    )
    return findings
  }
}

// ---------------------------------------------------------------------------
// Deterministic rules
// ---------------------------------------------------------------------------

function metricFinding(
  current: HarnessRun,
  baseline: HarnessRun,
  metric: HarnessRegressionMetric,
  after: number,
  before: number,
  template: string
): HarnessRegressionFinding[] {
  if (before <= 0) return []
  const percent = ((after - before) / before) * 100
  const rounded = Math.round(percent)
  let severity: HarnessRegressionSeverity
  if (percent >= REGRESSION_THRESHOLD) severity = 'regression'
  else if (percent >= WARNING_THRESHOLD) severity = 'warning'
  else if (percent <= -IMPROVEMENT_THRESHOLD) severity = 'improvement'
  else severity = 'info'
  return [
    {
      id: `reg-${current.id}-${metric}`,
      metric,
      severity,
      message: template.replace('{a}', before.toLocaleString()).replace('{b}', after.toLocaleString()),
      before: before.toLocaleString(),
      after: after.toLocaleString(),
      deltaPercent: rounded
    }
  ]
}

function durationFinding(
  current: HarnessRun,
  baseline: HarnessRun,
  after: number,
  before: number
): HarnessRegressionFinding[] {
  const percent = ((after - before) / before) * 100
  const rounded = Math.round(percent)
  let severity: HarnessRegressionSeverity
  if (percent >= DURATION_REGRESSION_THRESHOLD) severity = 'regression'
  else if (percent >= DURATION_WARNING_THRESHOLD) severity = 'warning'
  else if (percent <= -IMPROVEMENT_THRESHOLD) severity = 'improvement'
  else severity = 'info'
  return [
    {
      id: `reg-${current.id}-duration`,
      metric: 'duration',
      severity,
      message: `${formatDuration(before)} → ${formatDuration(after)}`,
      before: formatDuration(before),
      after: formatDuration(after),
      deltaPercent: rounded
    }
  ]
}

function toolFailureFinding(
  current: HarnessRun,
  baseline: HarnessRun
): HarnessRegressionFinding[] {
  if (current.toolFailureCount === baseline.toolFailureCount) return []
  const regression = current.toolFailureCount > baseline.toolFailureCount
  return [
    {
      id: `reg-${current.id}-tool-failures`,
      metric: 'tool-failures',
      severity: regression
        ? baseline.toolFailureCount === 0
          ? 'regression'
          : 'warning'
        : 'improvement',
      message: `${baseline.toolFailureCount} → ${current.toolFailureCount}`,
      before: String(baseline.toolFailureCount),
      after: String(current.toolFailureCount),
      deltaPercent: null
    }
  ]
}

function toolCallFinding(
  current: HarnessRun,
  baseline: HarnessRun
): HarnessRegressionFinding[] {
  if (baseline.toolCallCount <= 0) return []
  const percent = ((current.toolCallCount - baseline.toolCallCount) / baseline.toolCallCount) * 100
  if (Math.abs(percent) < WARNING_THRESHOLD) return []
  return [
    {
      id: `reg-${current.id}-tool-calls`,
      metric: 'tool-calls',
      severity: percent > 0 ? 'warning' : 'improvement',
      message: `${baseline.toolCallCount} → ${current.toolCallCount} tool calls`,
      before: String(baseline.toolCallCount),
      after: String(current.toolCallCount),
      deltaPercent: Math.round(percent)
    }
  ]
}

function evaluationFinding(
  current: HarnessRun,
  baseline: HarnessRun,
  evaluations: ReadonlyMap<string, HarnessEvaluation>
): HarnessRegressionFinding[] {
  const findings: HarnessRegressionFinding[] = []
  const currentEvaluation = evaluations.get(current.id)
  const baselineEvaluation = evaluations.get(baseline.id)
  const stagePairs: Array<[HarnessRegressionMetric, string]> = [
    ['tests', 'test'],
    ['build', 'build']
  ]
  for (const [metric, stageKind] of stagePairs) {
    const currentStage = currentEvaluation?.pipeline?.stages.find(
      (stage) => stage.kind === stageKind
    )
    const baselineStage = baselineEvaluation?.pipeline?.stages.find(
      (stage) => stage.kind === stageKind
    )
    if (!currentStage || currentStage.status === 'skipped') continue
    const before = stageLabel(baselineStage)
    const after = stageLabel(currentStage)
    if (before === after) continue
    findings.push({
      id: `reg-${current.id}-${metric}`,
      metric,
      severity:
        currentStage.status === 'failed' && baselineStage?.status === 'passed'
          ? 'regression'
          : baselineStage?.status === 'failed' && currentStage.status === 'passed'
            ? 'improvement'
            : 'warning',
      message: `${before} → ${after}`,
      before,
      after,
      deltaPercent: null
    })
  }
  if (currentEvaluation && baselineEvaluation) {
    if (
      currentEvaluation.status === 'failed' &&
      baselineEvaluation.status === 'passed'
    ) {
      findings.push({
        id: `reg-${current.id}-evaluation`,
        metric: 'evaluation',
        severity: 'regression',
        message: `${baselineEvaluation.status} → ${currentEvaluation.status}`,
        before: baselineEvaluation.status,
        after: currentEvaluation.status,
        deltaPercent: null
      })
    }
  }
  return findings
}

function stageLabel(
  stage: { status: string } | undefined
): string {
  if (!stage) return 'unknown'
  return stage.status
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`
}
