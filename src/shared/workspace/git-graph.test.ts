import { describe, expect, it } from 'vitest'
import type { GitCommitInfo } from '../types/workspace'
import { filterGitCommitsByTip, layoutGitGraph } from './git-graph'

function commit(hash: string, parents: string[] = []): GitCommitInfo {
  return {
    hash,
    parents,
    author: 'wangmiao',
    email: 'tuziling84@gmail.com',
    authoredAt: '2026-09-01T00:00:00Z',
    refs: [],
    subject: hash
  }
}

describe('layoutGitGraph', () => {
  it('keeps a linear history in one lane', () => {
    const rows = layoutGitGraph([commit('c3', ['c2']), commit('c2', ['c1']), commit('c1')])
    expect(rows.map((row) => row.column)).toEqual([0, 0, 0])
    expect(rows.map((row) => row.laneCount)).toEqual([1, 1, 1])
  })

  it('allocates and joins a second lane for a merge parent', () => {
    const commits = [
      commit('merge', ['main', 'topic']),
      commit('main', ['base']),
      commit('topic', ['base']),
      commit('base')
    ]
    const rows = layoutGitGraph(commits)
    expect(rows[0]?.parentLanes).toHaveLength(2)
    expect(rows.some((row) => row.laneCount >= 2)).toBe(true)
    expect(rows.at(-1)?.mergeSources).toHaveLength(2)

    expect(filterGitCommitsByTip(commits, 'topic').map((item) => item.hash)).toEqual([
      'topic',
      'base'
    ])
    expect(filterGitCommitsByTip(commits, null)).toBe(commits)
  })
})
