import { describe, expect, it } from 'vitest'
import {
  buildSessionForkTree,
  getSiblingBranchIds,
  groupSessionsByProject,
  mergeWorkspaceProjects
} from './session-tree'
import type { SessionInfo } from '../types/workspace'

function session(partial: Partial<SessionInfo> & Pick<SessionInfo, 'id'>): SessionInfo {
  return {
    path: `/tmp/${partial.id}.jsonl`,
    cwd: '/tmp/app',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-02T00:00:00.000Z',
    messageCount: 1,
    firstMessage: 'hi',
    ...partial
  }
}

describe('session tree', () => {
  it('groups sessions by project identity, not raw string equality', () => {
    const sessions = [
      session({
        id: 'a',
        cwd: 'C:\\repo\\wt',
        projectRoot: 'C:\\repo',
        projectKey: 'c:\\repo',
        modified: '2026-08-02T00:00:00.000Z'
      }),
      session({
        id: 'b',
        cwd: 'c:/repo',
        projectRoot: 'c:/repo',
        projectKey: 'c:\\repo',
        modified: '2026-08-01T00:00:00.000Z'
      })
    ]
    const groups = groupSessionsByProject(sessions, 'win32')
    expect(groups).toHaveLength(1)
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('nests sessions under saved project roots and keeps empty projects visible', () => {
    const groups = groupSessionsByProject([
      session({ id: 'repo', cwd: '/code/repo', projectRoot: '/code/repo' }),
      session({ id: 'other', cwd: '/code/other', projectRoot: '/code/other' })
    ])

    const merged = mergeWorkspaceProjects(['/code/empty', '/code/repo/'], groups)

    expect(merged.map((group) => group.name)).toEqual(['empty', 'repo', 'other'])
    expect(merged[0]?.sessions).toEqual([])
    expect(merged[1]?.sessions.map((item) => item.id)).toEqual(['repo'])
    expect(merged[2]?.sessions.map((item) => item.id)).toEqual(['other'])
  })

  it('builds a fork tree from parentSessionId', () => {
    const sessions = [
      session({ id: 'root', modified: '2026-08-03T00:00:00.000Z' }),
      session({ id: 'child', parentSessionId: 'root', modified: '2026-08-04T00:00:00.000Z' }),
      session({ id: 'orphan', parentSessionId: 'missing' })
    ]
    const tree = buildSessionForkTree(sessions)
    expect(tree.map((n) => n.session.id)).toEqual(['root', 'orphan'])
    expect(tree.find((n) => n.session.id === 'root')?.children.map((c) => c.session.id)).toEqual([
      'child'
    ])
  })

  it('finds in-session branch siblings that share a parentId', () => {
    const siblings = getSiblingBranchIds(
      [
        { id: 'u1', parentId: null },
        { id: 'a1', parentId: 'u1' },
        { id: 'a2', parentId: 'u1' },
        { id: 'a3', parentId: 'u1' }
      ],
      'a2'
    )
    expect(siblings).toEqual({ ids: ['a1', 'a2', 'a3'], index: 1 })
  })
})
