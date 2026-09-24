import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HarnessEvaluation, HarnessRun } from '@shared/types/harness'
import { JsonStore } from '../../services/storage'
import {
  EMPTY_BASELINE_STORE,
  RegressionService,
  formatDuration,
  type BaselineStoreRecord
} from './regression-service'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function tempStore(): JsonStore<BaselineStoreRecord> {
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-harness-test-'))
  tempDirs.push(dir)
  return new JsonStore(path.join(dir, 'baselines.json'), EMPTY_BASELINE_STORE)
}

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
    cwd: '/repo',
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

function evaluation(
  runId: string,
  status: HarnessEvaluation['status'],
  stages: Array<{ kind: string; status: string }> = []
): HarnessEvaluation {
  return {
    runId,
    sessionId: 's1',
    evaluatedAt: 2_000,
    status,
    checks: [],
    pipeline: {
      id: `pipeline-${runId}`,
      runId,
      name: 'standard',
      preset: 'standard',
      stages: stages.map((stage) => ({
        id: `stage-${stage.kind}`,
        kind: stage.kind as never,
        name: stage.kind,
        status: stage.status as never,
        command: null,
        duration: 500,
        evidence: null,
        message: null
      })),
      finalStatus: status,
      startedAt: 1_000,
      finishedAt: 1_500
    }
  }
}

describe('RegressionService', () => {
  it('persists and returns baselines per project cwd', async () => {
    const service = new RegressionService(tempStore())
    expect(await service.getBaseline('/repo')).toBeNull()

    const baseline = await service.setBaseline(run('run-a'), '/repo')
    expect(baseline).toMatchObject({ cwd: '/repo', runId: 'run-a', runLabel: 'ship it' })

    const stored = await service.getBaseline('/repo')
    expect(stored).toEqual(baseline)
    // Other projects stay untouched.
    expect(await service.getBaseline('/other')).toBeNull()
  })

  it('flags token regressions, warnings and improvements deterministically', async () => {
    const service = new RegressionService(tempStore())
    const baseline = run('base')
    const evaluations = new Map<string, HarnessEvaluation>()

    const regressed = service.compare(
      run('current', {
        usage: {
          inputTokens: 250,
          outputTokens: 250,
          cachedTokens: 0,
          totalTokens: 500,
          estimatedCost: 0.02
        }
      }),
      baseline,
      evaluations
    )
    const tokens = regressed.find((finding) => finding.metric === 'tokens')
    expect(tokens).toMatchObject({ severity: 'regression' })
    expect(tokens?.deltaPercent).toBe(150)
    expect(regressed.find((finding) => finding.metric === 'cost')).toMatchObject({
      severity: 'regression'
    })

    const warning = service.compare(
      run('current', {
        usage: {
          inputTokens: 130,
          outputTokens: 130,
          cachedTokens: 0,
          totalTokens: 260,
          estimatedCost: 0.012
        }
      }),
      baseline,
      evaluations
    )
    expect(warning.find((finding) => finding.metric === 'tokens')).toMatchObject({
      severity: 'warning',
      deltaPercent: 30
    })

    const improved = service.compare(
      run('current', {
        usage: {
          inputTokens: 60,
          outputTokens: 60,
          cachedTokens: 0,
          totalTokens: 120,
          estimatedCost: 0.005
        }
      }),
      baseline,
      evaluations
    )
    expect(improved.find((finding) => finding.metric === 'tokens')).toMatchObject({
      severity: 'improvement'
    })
  })

  it('compares evaluation stages between runs', () => {
    const service = new RegressionService(tempStore())
    const baseline = run('base')
    const evaluations = new Map<string, HarnessEvaluation>([
      ['base', evaluation('base', 'passed', [{ kind: 'test', status: 'passed' }])],
      ['current', evaluation('current', 'failed', [{ kind: 'test', status: 'failed' }])]
    ])

    const findings = service.compare(run('current'), baseline, evaluations)
    const tests = findings.find((finding) => finding.metric === 'tests')
    expect(tests).toMatchObject({ severity: 'regression' })
    expect(findings.find((finding) => finding.metric === 'evaluation')).toMatchObject({
      severity: 'regression'
    })
  })
})

describe('formatDuration', () => {
  it('formats milliseconds, seconds and minutes', () => {
    expect(formatDuration(950)).toBe('950ms')
    expect(formatDuration(2_500)).toBe('2.5s')
    expect(formatDuration(90_000)).toBe('1m30s')
  })
})
