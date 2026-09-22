/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — verbatim Electron port; runtime tsconfig is noUncheckedIndexedAccess.
import { describe, expect, it } from 'vitest'
import type { HarnessTask } from '../harness-control/types.js'
import {
  dependencyDepth,
  dependentsOf,
  detectCycles,
  resolveDependencies,
  topologicalLayers
} from './dependency-resolver.js'

function task(id: string, overrides: Partial<HarnessTask> = {}): HarnessTask {
  return {
    id,
    orchestrationId: 'orch',
    projectId: null,
    title: id,
    description: null,
    status: 'pending',
    priority: 'normal',
    assignedAgentId: null,
    parentTaskId: null,
    dependencies: [],
    inputArtifactIds: [],
    runIds: [],
    artifactIds: [],
    lastRunId: null,
    retryCount: 0,
    reviewRequired: false,
    reviewAgentId: null,
    reviewVerdict: null,
    reviewSummary: null,
    error: null,
    createdAt: 1,
    startedAt: null,
    finishedAt: null,
    ...overrides
  }
}

describe('detectCycles', () => {
  it('returns no cycles for a DAG', () => {
    const tasks = [
      task('a'),
      task('b', { dependencies: ['a'] }),
      task('c', { dependencies: ['b'] })
    ]
    expect(detectCycles(tasks)).toEqual([])
  })

  it('detects direct and indirect cycles', () => {
    const direct = [task('a', { dependencies: ['a'] })]
    expect(detectCycles(direct)).toEqual([['a', 'a']])

    const indirect = [
      task('a', { dependencies: ['c'] }),
      task('b', { dependencies: ['a'] }),
      task('c', { dependencies: ['b'] })
    ]
    const cycles = detectCycles(indirect)
    expect(cycles.length).toBeGreaterThan(0)
    expect(cycles.flat()).toEqual(expect.arrayContaining(['a', 'b', 'c']))
  })

  it('ignores missing dependency ids', () => {
    const tasks = [task('a', { dependencies: ['ghost'] })]
    expect(detectCycles(tasks)).toEqual([])
  })
})

describe('resolveDependencies', () => {
  it('computes ready and blocked tasks', () => {
    const tasks = [
      task('a'),
      task('b', { dependencies: ['a'] }),
      task('c', { dependencies: ['ghost'] })
    ]
    const resolution = resolveDependencies(tasks)
    expect(resolution.ready).toEqual(['a'])
    expect(resolution.blocked).toEqual([
      { taskId: 'b', unmet: ['a'] },
      { taskId: 'c', unmet: ['ghost (missing)'] }
    ])
  })

  it('treats completed and cancelled dependencies as satisfied', () => {
    const tasks = [
      task('a', { status: 'completed' }),
      task('b', { status: 'cancelled' }),
      task('c', { dependencies: ['a', 'b'] })
    ]
    expect(resolveDependencies(tasks).ready).toEqual(['c'])
  })

  it('keeps failed dependencies unmet', () => {
    const tasks = [task('a', { status: 'failed' }), task('b', { dependencies: ['a'] })]
    const resolution = resolveDependencies(tasks)
    expect(resolution.ready).toEqual([])
    expect(resolution.blocked).toEqual([{ taskId: 'b', unmet: ['a'] }])
  })

  it('marks cycle members as blocked', () => {
    const tasks = [
      task('a', { dependencies: ['b'] }),
      task('b', { dependencies: ['a'] })
    ]
    const resolution = resolveDependencies(tasks)
    expect(resolution.ready).toEqual([])
    expect(resolution.blocked.every((item) => item.unmet.includes('cycle'))).toBe(true)
  })
})

describe('topologicalLayers', () => {
  it('groups tasks into parallel waves', () => {
    const tasks = [
      task('a'),
      task('b'),
      task('c', { dependencies: ['a'] }),
      task('d', { dependencies: ['a', 'b'] }),
      task('e', { dependencies: ['d'] })
    ]
    const layers = topologicalLayers(tasks)
    expect(layers[0].sort()).toEqual(['a', 'b'])
    expect(layers[1].sort()).toEqual(['c', 'd'])
    expect(layers[2]).toEqual(['e'])
  })

  it('excludes cycle members', () => {
    const tasks = [
      task('a', { dependencies: ['b'] }),
      task('b', { dependencies: ['a'] }),
      task('c')
    ]
    const layers = topologicalLayers(tasks)
    expect(layers).toEqual([['c']])
  })
})

describe('dependentsOf / dependencyDepth', () => {
  it('finds transitive dependents', () => {
    const tasks = [
      task('a'),
      task('b', { dependencies: ['a'] }),
      task('c', { dependencies: ['b'] }),
      task('d')
    ]
    expect(dependentsOf('a', tasks).sort()).toEqual(['b', 'c'])
    expect(dependentsOf('d', tasks)).toEqual([])
  })

  it('computes the longest upward chain', () => {
    const tasks = [
      task('a'),
      task('b', { dependencies: ['a'] }),
      task('c', { dependencies: ['b', 'a'] })
    ]
    expect(dependencyDepth('a', tasks)).toBe(0)
    expect(dependencyDepth('b', tasks)).toBe(1)
    expect(dependencyDepth('c', tasks)).toBe(2)
  })
})
