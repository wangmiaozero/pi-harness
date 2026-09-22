/**
 * Harness Diagnostics.
 *
 * Structured failure analysis over real trace evidence only. Categories,
 * severity and the root-cause chain are derived from the run verdict, trace
 * spans and evaluation stages — never guessed by an LLM.
 */

import type {
  HarnessDiagnostic,
  HarnessDiagnosticCategory,
  HarnessDiagnosticCause,
  HarnessDiagnosticSeverity,
  HarnessEvaluation,
  HarnessInsight,
  HarnessPolicyDomain,
  HarnessRun,
  HarnessRunTrace
} from '../types.js'

const MAX_CAUSES = 5
const EVIDENCE_PREVIEW = 300

export class DiagnosticsService {
  /**
   * Diagnose a run. Failed runs get a primary diagnostic with a root-cause
   * chain; successful runs with rough edges get warning-level entries.
   */
  diagnose(
    run: HarnessRun,
    trace: HarnessRunTrace | null,
    evaluation: HarnessEvaluation | null
  ): HarnessDiagnostic[] {
    const diagnostics: HarnessDiagnostic[] = []
    const failedSpans = (trace?.spans ?? []).filter((span) => span.status === 'failed')
    const policyBlocks = (trace?.events ?? []).filter(
      (item) => item.event.type === 'policy.denied'
    )

    if (run.status === 'failed' || run.error) {
      const category = classifyFailure(run, failedSpans, evaluation)
      diagnostics.push({
        id: `diag-${run.id}-primary`,
        runId: run.id,
        sessionId: run.sessionId,
        severity: severityFor(run, category),
        category,
        title: titleFor(category),
        message: run.error ?? titleFor(category),
        eventId: firstEventId(trace, 'runtime.error'),
        spanId: failedSpans[0]?.id ?? null,
        evidence: evidenceFor(run, failedSpans, evaluation),
        recommendation: recommendationFor(category),
        causeChain: buildCauseChain(run, failedSpans, evaluation)
      })
    } else if (run.status === 'aborted') {
      diagnostics.push({
        id: `diag-${run.id}-aborted`,
        runId: run.id,
        sessionId: run.sessionId,
        severity: 'info',
        category: 'user-abort',
        title: 'Run aborted',
        message: run.budgetExceeded ?? 'The run was aborted before finishing.',
        eventId: firstEventId(trace, 'runtime.aborted'),
        spanId: null,
        evidence: run.budgetExceeded,
        recommendation: null,
        causeChain: []
      })
    }

    if (run.budgetExceeded) {
      diagnostics.push({
        id: `diag-${run.id}-budget`,
        runId: run.id,
        sessionId: run.sessionId,
        severity: 'warning',
        category: 'budget-exceeded',
        title: 'Budget exceeded',
        message: run.budgetExceeded,
        eventId: firstEventId(trace, 'budget.exceeded'),
        spanId: null,
        evidence: run.budgetExceeded,
        recommendation:
          'Raise the budget in Policy or split the task into smaller runs.',
        causeChain: []
      })
    }

    if (policyBlocks.length) {
      diagnostics.push({
        id: `diag-${run.id}-policy`,
        runId: run.id,
        sessionId: run.sessionId,
        severity: 'warning',
        category: 'policy-block',
        title: 'Policy blocked actions',
        message: `${policyBlocks.length} action(s) were denied by Harness Policy.`,
        eventId: policyBlocks[0]?.id ?? null,
        spanId: null,
        evidence: policyBlocks
          .slice(0, 5)
          .map((item) => {
            const event = item.event as {
              domain: HarnessPolicyDomain
              target: string
              rule: string
            }
            return `${event.domain}: ${event.target} (${event.rule})`
          })
          .join('\n'),
        recommendation: 'Adjust the Policy rules if these actions should be allowed.',
        causeChain: []
      })
    }

    if (run.toolFailureCount > 0 && run.status !== 'failed') {
      diagnostics.push({
        id: `diag-${run.id}-tools`,
        runId: run.id,
        sessionId: run.sessionId,
        severity: 'warning',
        category: 'tool-failure',
        title: 'Tool failures',
        message: `${run.toolFailureCount} tool call(s) failed during this run.`,
        eventId: null,
        spanId: failedSpans[0]?.id ?? null,
        evidence: failedSpans
          .slice(0, 5)
          .map((span) => `${span.type} ${span.name}${span.error ? `: ${span.error}` : ''}`)
          .join('\n'),
        recommendation: 'Inspect the failed spans in the Trace Waterfall.',
        causeChain: []
      })
    }

    const failedStage = evaluation?.pipeline?.stages.find((stage) => stage.status === 'failed')
    if (failedStage && run.status !== 'failed') {
      diagnostics.push({
        id: `diag-${run.id}-evaluation`,
        runId: run.id,
        sessionId: run.sessionId,
        severity: 'error',
        category: 'evaluation-failure',
        title: `${failedStage.name} failed`,
        message: failedStage.message ?? `${failedStage.name} stage failed.`,
        eventId: null,
        spanId: null,
        evidence: failedStage.evidence,
        recommendation: 'Re-run the failing command locally to see the full output.',
        causeChain: []
      })
    }

    return diagnostics
  }

  /** Failure-category histogram over many runs (project stats). */
  aggregate(runs: readonly HarnessRun[]): Array<{
    category: HarnessDiagnosticCategory
    count: number
    percent: number
  }> {
    const counts = new Map<HarnessDiagnosticCategory, number>()
    for (const run of runs) {
      if (run.status !== 'failed' && run.status !== 'aborted') continue
      const category = classifyFailure(run, [], null)
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0)
    if (!total) return []
    return [...counts.entries()]
      .map(([category, count]) => ({
        category,
        count,
        percent: Math.round((count / total) * 100)
      }))
      .sort((a, b) => b.count - a.count)
  }
}

// ---------------------------------------------------------------------------
// Insights — rule-generated observations computed from real metrics.
// ---------------------------------------------------------------------------

export function buildInsights(
  run: HarnessRun,
  trace: HarnessRunTrace | null,
  baselineDelta: { percent: number } | null
): HarnessInsight[] {
  const insights: HarnessInsight[] = []
  const spans = trace?.spans ?? []

  if (baselineDelta && Number.isFinite(baselineDelta.percent) && baselineDelta.percent !== 0) {
    insights.push({
      id: `insight-${run.id}-tokens`,
      kind: 'token-delta',
      params: {
        percent: formatSigned(baselineDelta.percent),
        tokens: run.usage.totalTokens.toLocaleString()
      }
    })
  }

  const failures = new Map<string, number>()
  for (const span of spans) {
    if (span.status !== 'failed') continue
    failures.set(span.name, (failures.get(span.name) ?? 0) + 1)
  }
  const worst = [...failures.entries()].sort((a, b) => b[1] - a[1])[0]
  if (worst) {
    insights.push({
      id: `insight-${run.id}-tools`,
      kind: 'tool-failures',
      params: { tool: worst[0], count: worst[1] }
    })
  }

  const totalDuration = spans.reduce((sum, span) => sum + (span.duration ?? 0), 0)
  if (totalDuration > 0) {
    const byType = new Map<string, number>()
    for (const span of spans) {
      byType.set(span.type, (byType.get(span.type) ?? 0) + (span.duration ?? 0))
    }
    const dominant = [...byType.entries()].sort((a, b) => b[1] - a[1])[0]
    if (dominant && dominant[0] !== 'model') {
      insights.push({
        id: `insight-${run.id}-share-${dominant[0]}`,
        kind: 'duration-share',
        params: {
          type: dominant[0],
          percent: Math.round((dominant[1] / totalDuration) * 100)
        }
      })
    }
    const modelShare = byType.get('model') ?? 0
    if (modelShare > 0) {
      insights.push({
        id: `insight-${run.id}-model-share`,
        kind: 'model-share',
        params: { percent: Math.round((modelShare / totalDuration) * 100) }
      })
    }
  }

  const compactions = spans.filter((span) => span.type === 'compaction').length
  if (run.contextUsage?.percent !== null && run.contextUsage?.percent !== undefined) {
    insights.push({
      id: `insight-${run.id}-context`,
      kind: 'context-compaction',
      params: {
        percent: Math.round(run.contextUsage.percent),
        compactions
      }
    })
  }

  const recoveries = spans.filter((span) => span.type === 'recovery').length
  if (recoveries > 0) {
    insights.push({
      id: `insight-${run.id}-recovery`,
      kind: 'recovery',
      params: { count: recoveries }
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Classification helpers — deterministic rules over real evidence.
// ---------------------------------------------------------------------------

export function classifyFailure(
  run: HarnessRun,
  failedSpans: ReadonlyArray<HarnessRunTrace['spans'][number]>,
  evaluation: HarnessEvaluation | null
): HarnessDiagnosticCategory {
  if (run.budgetExceeded) return 'budget-exceeded'
  const error = (run.error ?? '').toLowerCase()
  if (error.includes('timeout') || error.includes('timed out')) return 'timeout'
  if (
    error.includes('provider') ||
    error.includes('api key') ||
    error.includes('unauthorized') ||
    error.includes('401') ||
    error.includes('429') ||
    error.includes('rate limit')
  ) {
    return 'provider-failure'
  }
  if (error.includes('model')) return 'model-failure'
  const shellFailed = failedSpans.some((span) => span.type === 'shell')
  if (shellFailed) return 'shell-failure'
  if (failedSpans.length) return 'tool-failure'
  const failedStage = evaluation?.pipeline?.stages.find((stage) => stage.status === 'failed')
  if (failedStage) return 'evaluation-failure'
  if (run.steps.some((step) => step.kind === 'policy' && step.status === 'skipped')) {
    return 'policy-block'
  }
  if (run.status === 'aborted') return 'user-abort'
  return 'unknown'
}

function severityFor(run: HarnessRun, category: HarnessDiagnosticCategory): HarnessDiagnosticSeverity {
  if (category === 'provider-failure' || category === 'unknown') return 'error'
  if (run.status === 'failed') return 'critical'
  return 'error'
}

function titleFor(category: HarnessDiagnosticCategory): string {
  switch (category) {
    case 'tool-failure':
      return 'Tool failure'
    case 'shell-failure':
      return 'Shell command failure'
    case 'model-failure':
      return 'Model failure'
    case 'provider-failure':
      return 'Provider failure'
    case 'policy-block':
      return 'Policy blocked the run'
    case 'timeout':
      return 'Timeout'
    case 'budget-exceeded':
      return 'Budget exceeded'
    case 'evaluation-failure':
      return 'Evaluation failure'
    case 'user-abort':
      return 'Run aborted'
    default:
      return 'Run failed'
  }
}

function recommendationFor(category: HarnessDiagnosticCategory): string | null {
  switch (category) {
    case 'provider-failure':
      return 'Check the provider status and credentials, then retry the run.'
    case 'timeout':
      return 'Raise the duration budget or split the task into smaller runs.'
    case 'budget-exceeded':
      return 'Raise the budget in Policy or split the task into smaller runs.'
    case 'shell-failure':
      return 'Re-run the failing command locally to see the full output.'
    case 'tool-failure':
      return 'Inspect the failed spans in the Trace Waterfall.'
    case 'evaluation-failure':
      return 'Re-run the failing check locally to see the full output.'
    case 'policy-block':
      return 'Adjust the Policy rules if these actions should be allowed.'
    case 'user-abort':
      return 'Resume from the last checkpoint or fork the session to continue.'
    default:
      return 'Inspect the trace events around the failure for details.'
  }
}

/**
 * Root-cause chain from real evidence: run verdict → evaluation stage →
 * failed span → span error. Only links that actually exist are included.
 */
function buildCauseChain(
  run: HarnessRun,
  failedSpans: ReadonlyArray<HarnessRunTrace['spans'][number]>,
  evaluation: HarnessEvaluation | null
): HarnessDiagnosticCause[] {
  const chain: HarnessDiagnosticCause[] = []
  const failedStage = evaluation?.pipeline?.stages.find((stage) => stage.status === 'failed')
  if (failedStage) {
    chain.push({
      title: `${failedStage.name} failed`,
      message: failedStage.message ?? '',
      spanId: null,
      eventId: null
    })
    if (failedStage.evidence) {
      chain.push({
        title: 'Failing command',
        message: failedStage.evidence.slice(0, EVIDENCE_PREVIEW),
        spanId: null,
        eventId: null
      })
    }
  }
  for (const span of failedSpans.slice(0, MAX_CAUSES - chain.length)) {
    chain.push({
      title: `${span.type} span "${span.name}" failed`,
      message: span.error ?? 'The span reported an error.',
      spanId: span.id,
      eventId: null
    })
  }
  if (run.error && !chain.some((cause) => cause.message === run.error)) {
    chain.push({
      title: 'Run error',
      message: run.error.slice(0, EVIDENCE_PREVIEW),
      spanId: null,
      eventId: null
    })
  }
  return chain.slice(0, MAX_CAUSES)
}

function evidenceFor(
  run: HarnessRun,
  failedSpans: ReadonlyArray<HarnessRunTrace['spans'][number]>,
  evaluation: HarnessEvaluation | null
): string | null {
  const parts: string[] = []
  if (run.error) parts.push(run.error.slice(0, EVIDENCE_PREVIEW))
  const stage = evaluation?.pipeline?.stages.find((item) => item.status === 'failed')
  if (stage?.evidence) parts.push(stage.evidence.slice(0, EVIDENCE_PREVIEW))
  for (const span of failedSpans.slice(0, 3)) {
    parts.push(`${span.type} ${span.name}${span.error ? `: ${span.error}` : ' (failed)'}`)
  }
  return parts.length ? parts.join('\n') : null
}

function firstEventId(
  trace: HarnessRunTrace | null,
  type: string
): string | null {
  return trace?.events.find((item) => item.event.type === type)?.id ?? null
}

function formatSigned(value: number): string {
  return `${value > 0 ? '+' : ''}${Math.round(value)}`
}
