import { describe, expect, it } from 'vitest'
import { classifyGitStatus, parseGitPorcelainV1 } from './git-status'

describe('git porcelain v1', () => {
  it('parses modified, untracked, and renamed records', () => {
    const output = [' M src/a.ts', '?? new.ts', 'R  renamed.ts', 'old.ts', ''].join('\0')
    const entries = parseGitPorcelainV1(output)
    expect(entries).toEqual([
      { path: 'src/a.ts', indexStatus: ' ', worktreeStatus: 'M' },
      { path: 'new.ts', indexStatus: '?', worktreeStatus: '?' },
      { path: 'renamed.ts', originalPath: 'old.ts', indexStatus: 'R', worktreeStatus: ' ' }
    ])
    expect(classifyGitStatus(entries[0]!)).toEqual({ status: 'modified', code: 'M' })
    expect(classifyGitStatus(entries[1]!)).toEqual({ status: 'untracked', code: 'U' })
    expect(classifyGitStatus(entries[2]!)).toEqual({ status: 'renamed', code: 'R' })
  })
})
