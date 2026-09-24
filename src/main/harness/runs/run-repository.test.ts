import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HarnessRun } from '@shared/types/harness'
import { JsonStore } from '../../services/storage'
import {
  buildRunTree,
  EMPTY_RUN_STORE,
  JsonRunRepository,
  treeParentId,
  type RunStoreRecord
} from './run-repository'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function tempStore(): JsonStore<RunStoreRecord> {
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-harness-test-'))
  tempDirs.push(dir)
  return new JsonStore(path.join(dir, 'runs.json'), EMPTY_RUN_STORE)
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
    prompt: `run ${id}`,
    usage: {
      inputTokens: 10,
      outputTokens: 10,
      cachedTokens: 0,
      totalTokens: 20,
      estimatedCost: 0.01
    },
    toolCallCount: 1,
    toolFailureCount: 0,
    contextUsage: null,
    result: null,
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

describe('JsonRunRepository', () => {
  it('saves, reads and lists runs by session and cwd', async () => {
    const repository = new JsonRunRepository(tempStore())
    await repository.save(run('run-1', { sessionId: 's1', cwd: '/repo' }))
    await repository.save(run('run-2', { sessionId: 's2', cwd: '/other', prompt: 'other project' }))

    expect(await repository.get('run-1')).toMatchObject({ id: 'run-1' })
    expect(await repository.get('missing')).toBeNull()
    expect((await repository.listBySession('s1')).map((item) => item.id)).toEqual(['run-1'])
    expect((await repository.listByCwd('/other')).map((item) => item.id)).toEqual(['run-2'])
    expect(await repository.listAll()).toHaveLength(2)
  })

  it('upserts by id instead of duplicating runs', async () => {
    const repository = new JsonRunRepository(tempStore())
    await repository.save(run('run-1', { status: 'running' }))
    await repository.save(run('run-1', { status: 'success', finishedAt: 2_000 }))

    const stored = await repository.get('run-1')
    expect(stored).toMatchObject({ id: 'run-1', status: 'success' })
    expect(await repository.listAll()).toHaveLength(1)
  })

  it('prunes runs older than the retention window', async () => {
    const repository = new JsonRunRepository(tempStore())
    const day = 24 * 60 * 60 * 1000
    const now = 1_700_000_000_000
    await repository.saveMany([
      run('fresh', { startedAt: now - day }),
      run('stale', { startedAt: now - 3 * day })
    ])

    expect(await repository.prune(now, 2)).toBe(1)
    expect((await repository.listAll()).map((item) => item.id)).toEqual(['fresh'])
    // retentionDays 0 keeps everything forever.
    await repository.save(run('ancient', { startedAt: 1 }))
    expect(await repository.prune(now, 0)).toBe(0)
    expect(await repository.listAll()).toHaveLength(2)
  })
})

describe('buildRunTree', () => {
  it('nests forks and re-executions under their parent runs', () => {
    const parent = run('parent', { startedAt: 1_000 })
    const forked = run('forked', {
      sessionId: 's2',
      relation: 'fork',
      forkedFromRunId: 'parent',
      startedAt: 2_000
    })
    const retried = run('retried', {
      relation: 'retry',
      parentRunId: 'parent',
      startedAt: 3_000
    })
    const sibling = run('sibling', { startedAt: 4_000 })

    const tree = buildRunTree([parent, forked, retried, sibling])
    // Roots: parent + sibling (children attach under parent).
    expect(tree.map((node) => node.runId).sort()).toEqual(['parent', 'sibling'])
    const parentNode = tree.find((node) => node.runId === 'parent')
    expect(parentNode?.children.map((child) => child.runId).sort()).toEqual(['forked', 'retried'])
  })

  it('never orphans a tree when the fork parent is missing', () => {
    const orphan = run('orphan', { forkedFromRunId: 'gone' })
    const tree = buildRunTree([orphan])
    expect(tree.map((node) => node.runId)).toEqual(['orphan'])
  })

  it('derives tree edges only from real relations', () => {
    expect(treeParentId(run('a', { forkedFromRunId: 'p' }))).toBe('p')
    expect(treeParentId(run('a', { relation: 'retry', parentRunId: 'p' }))).toBe('p')
    expect(treeParentId(run('a', { relation: 'original', parentRunId: 'p' }))).toBeNull()
  })
})
