import { describe, expect, it } from 'vitest'
import type { HarnessEvaluation, HarnessRun } from '@shared/types/harness'
import { compareRuns, lineDiffSection } from './compare-service'

function run(id: string, overrides: Partial<HarnessRun> = {}): HarnessRun {
  return {
    id,
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
    provider: 'provider-a',
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
    contextUsage: null,
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

function evaluation(status: HarnessEvaluation['status']): HarnessEvaluation {
  return {
    runId: 'run-1',
    sessionId: 's1',
    evaluatedAt: 2_000,
    status,
    checks: []
  }
}

describe('compareRuns', () => {
  it('builds metric rows from real run evidence with directional tones', () => {
    const comparison = compareRuns({
      runA: run('run-a'),
      runB: run('run-b', {
        model: 'model-b',
        usage: {
          inputTokens: 200,
          outputTokens: 200,
          cachedTokens: 0,
          totalTokens: 400,
          estimatedCost: 0.02
        },
        toolFailureCount: 2
      }),
      evaluationA: evaluation('passed'),
      evaluationB: evaluation('failed'),
      artifactsA: [],
      artifactsB: []
    })

    const byId = new Map(comparison.metrics.map((metric) => [metric.id, metric]))
    expect(byId.get('model')).toMatchObject({
      a: 'model-a',
      b: 'model-b',
      tone: 'neutral',
      delta: 'model-a → model-b'
    })
    // Tones describe run B against run A. B burned more tokens (lower is better).
    expect(byId.get('tokens')).toMatchObject({ a: '200', b: '400', tone: 'worse' })
    expect(byId.get('cost')).toMatchObject({ tone: 'worse' })
    expect(byId.get('toolFailures')).toMatchObject({ a: '0', b: '2', tone: 'worse' })
    expect(comparison.runA.id).toBe('run-a')
    expect(comparison.runB.id).toBe('run-b')
  })

  it('marks run B improvements as better', () => {
    const comparison = compareRuns({
      runA: run('run-a'),
      runB: run('run-b', {
        usage: {
          inputTokens: 50,
          outputTokens: 50,
          cachedTokens: 0,
          totalTokens: 100,
          estimatedCost: 0.005
        }
      }),
      evaluationA: null,
      evaluationB: null,
      artifactsA: [],
      artifactsB: []
    })
    const byId = new Map(comparison.metrics.map((metric) => [metric.id, metric]))
    expect(byId.get('tokens')).toMatchObject({ a: '200', b: '100', tone: 'better' })
    expect(byId.get('cost')).toMatchObject({ tone: 'better' })
  })

  it('keeps identical runs neutral', () => {
    const comparison = compareRuns({
      runA: run('run-a'),
      runB: run('run-b'),
      evaluationA: null,
      evaluationB: null,
      artifactsA: [],
      artifactsB: []
    })
    for (const metric of comparison.metrics) {
      if (metric.id === 'status') continue
      expect([metric.a, metric.b, metric.tone]).toEqual([
        metric.a,
        metric.a,
        'neutral'
      ])
    }
  })
})

describe('lineDiffSection', () => {
  it('marks added and removed lines against a shared LCS backbone', () => {
    const section = lineDiffSection('prompt', ['fix', 'the', 'bug'], ['fix', 'a', 'bug'])
    const kinds = section.lines.map((line) => line.kind)
    expect(kinds).toEqual(['same', 'removed', 'added', 'same'])
    expect(section.id).toBe('prompt')
  })

  it('returns no lines when both sides are empty', () => {
    const section = lineDiffSection('tools', [], [])
    expect(section.lines).toEqual([])
  })
})
