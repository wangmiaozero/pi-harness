import { describe, expect, it } from 'vitest'
import type { HarnessRun, HarnessRunTrace, HarnessTraceSpan } from '@shared/types/harness'
import { buildInsights, classifyFailure, DiagnosticsService } from './diagnostics-service'

function run(overrides: Partial<HarnessRun> = {}): HarnessRun {
  return {
    id: 'run-1',
    sessionId: 's1',
    parentRunId: null,
    relation: 'original',
    forkedFromRunId: null,
    forkedFromEventId: null,
    forkedFromCheckpointId: null,
    status: 'success',
    source: 'live',
    anchorEntryId: null,
    cwd: null,
    startedAt: 1_000,
    finishedAt: 11_000,
    model: 'model-a',
    provider: null,
    prompt: 'ship it',
    usage: {
      inputTokens: 100,
      outputTokens: 100,
      cachedTokens: 0,
      totalTokens: 200,
      estimatedCost: 0.01
    },
    toolCallCount: 5,
    toolFailureCount: 0,
    contextUsage: { percent: 60, contextWindow: 100_000, tokens: 60_000 },
    result: 'done',
    error: null,
    agentId: null,
    taskId: null,
    orchestrationId: null,
    budgetExceeded: null,
    steps: [],
    checkpointIds: [],
    ...overrides
  }
}

function span(
  id: string,
  type: HarnessTraceSpan['type'],
  name: string,
  status: HarnessTraceSpan['status'],
  startedAt: number,
  finishedAt: number
): HarnessTraceSpan {
  return {
    id,
    runId: 'run-1',
    parentSpanId: null,
    type,
    name,
    status,
    startedAt,
    finishedAt,
    duration: finishedAt - startedAt,
    metadata: {},
    error: null
  }
}

function trace(spans: HarnessTraceSpan[]): HarnessRunTrace {
  return { runId: 'run-1', sessionId: 's1', source: 'recorded', spans, events: [] }
}

describe('classifyFailure', () => {
  it('classifies from real error text, failed spans and evaluation stages', () => {
    expect(classifyFailure(run({ error: 'request timed out' }), [], null)).toBe('timeout')
    expect(classifyFailure(run({ error: 'provider 429 rate limit' }), [], null)).toBe(
      'provider-failure'
    )
    expect(
      classifyFailure(run({ error: 'boom' }), [span('sp-1', 'shell', 'bash', 'failed', 1, 2)], null)
    ).toBe('shell-failure')
    expect(
      classifyFailure(run({ error: 'boom' }), [span('sp-1', 'tool', 'edit', 'failed', 1, 2)], null)
    ).toBe('tool-failure')
    expect(classifyFailure(run({ budgetExceeded: 'token budget exceeded' }), [], null)).toBe(
      'budget-exceeded'
    )
    expect(classifyFailure(run(), [], null)).toBe('unknown')
  })
})

describe('DiagnosticsService.diagnose', () => {
  it('produces a primary diagnostic with a cause chain for failed runs', () => {
    const service = new DiagnosticsService()
    const failed = run({
      status: 'failed',
      error: 'bash exited with code 1',
      toolFailureCount: 1
    })
    const spans = [
      span('sp-model', 'model', 'model-a', 'success', 1_000, 4_000),
      span('sp-shell', 'shell', 'bash', 'failed', 4_000, 5_000)
    ]
    const diagnostics = service.diagnose(failed, trace(spans), null)

    expect(diagnostics[0]).toMatchObject({
      runId: 'run-1',
      severity: 'critical',
      category: 'shell-failure'
    })
    expect(diagnostics[0].causeChain.length).toBeGreaterThan(0)
    expect(diagnostics[0].causeChain[0]).toMatchObject({
      title: 'shell span "bash" failed'
    })
  })

  it('reports aborted runs as user-abort info without inventing failures', () => {
    const service = new DiagnosticsService()
    const diagnostics = service.diagnose(run({ status: 'aborted' }), null, null)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ category: 'user-abort', severity: 'info' })
  })

  it('flags budget exceedance as a separate warning', () => {
    const service = new DiagnosticsService()
    const diagnostics = service.diagnose(
      run({ status: 'success', budgetExceeded: 'cost budget exceeded' }),
      null,
      null
    )
    expect(
      diagnostics.find((diagnostic) => diagnostic.category === 'budget-exceeded')
    ).toMatchObject({ severity: 'warning' })
  })
})

describe('buildInsights', () => {
  it('derives token deltas, tool failures and duration shares from real spans', () => {
    const insights = buildInsights(
      run(),
      trace([
        span('sp-model', 'model', 'model-a', 'success', 1_000, 2_000),
        span('sp-tool', 'tool', 'edit', 'failed', 2_000, 5_000),
        span('sp-shell', 'shell', 'bash', 'success', 5_000, 6_000)
      ]),
      { percent: 25 }
    )

    const byKind = new Map(insights.map((insight) => [insight.kind, insight]))
    expect(byKind.get('token-delta')?.params).toMatchObject({ percent: '+25' })
    expect(byKind.get('tool-failures')?.params).toMatchObject({ tool: 'edit', count: 1 })
    expect(byKind.get('duration-share')?.params).toMatchObject({ type: 'tool', percent: 60 })
    expect(byKind.get('model-share')?.params).toMatchObject({ percent: 20 })
    expect(byKind.get('context-compaction')?.params).toMatchObject({ percent: 60 })
  })

  it('returns no insights without evidence', () => {
    expect(buildInsights(run({ contextUsage: null }), null, null)).toEqual([])
  })
})
