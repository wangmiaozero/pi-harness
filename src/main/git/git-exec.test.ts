import { describe, expect, it } from 'vitest'
import { GitError } from '../services/errors'
import { isNotAGitRepository } from './git-exec'

describe('isNotAGitRepository', () => {
  it('detects git stderr for a folder without a repository', () => {
    expect(
      isNotAGitRepository(
        new GitError('fatal: not a git repository (or any of the parent directories): .git')
      )
    ).toBe(true)
  })

  it('ignores other git failures', () => {
    expect(isNotAGitRepository(new GitError('fatal: ambiguous argument HEAD'))).toBe(false)
    expect(isNotAGitRepository(new Error('spawn git ENOENT'))).toBe(false)
  })
})
