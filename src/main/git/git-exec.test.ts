import { describe, expect, it } from 'vitest'
import { GitError } from '../services/errors'
import { isEmptyGitHistory, isNotAGitRepository, normalizeGitFailure } from './git-exec'

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

describe('normalizeGitFailure', () => {
  it('returns an actionable pull error without exposing the executed command', () => {
    const failure = normalizeGitFailure({
      code: 1,
      stderr: 'fatal: Not possible to fast-forward, aborting.',
      message: 'Command failed: git -C /Users/example/private pull --ff-only'
    })

    expect(failure.details.reason).toBe('non-fast-forward')
    expect(failure.userMessage).toContain('merge or rebase')
    expect(failure.message).not.toContain('/Users/example/private')
    expect(failure.message).not.toContain('git -C')
  })

  it('uses a safe fallback when git returns no output', () => {
    const failure = normalizeGitFailure({
      code: 1,
      message: 'Command failed: git -C /Users/example/private pull --ff-only'
    })

    expect(failure.details.reason).toBe('unknown')
    expect(failure.message).toBe('Git operation failed. Please retry.')
    expect(failure.userMessage).toBe('Git operation failed. Please retry.')
  })

  it('preserves repository and empty-history semantics without raw stderr', () => {
    const noRepository = normalizeGitFailure({
      stderr: 'fatal: not a git repository (or any parent): .git'
    })
    const noHistory = normalizeGitFailure({
      stderr: "fatal: your current branch 'main' does not have any commits yet"
    })

    expect(noRepository.details.reason).toBe('not-repository')
    expect(noHistory.details.reason).toBe('no-commits')
    expect(
      isEmptyGitHistory(new GitError(noHistory.message, noHistory.details))
    ).toBe(true)
  })

  it('classifies authentication and local-change failures', () => {
    expect(
      normalizeGitFailure({ stderr: 'git@github.com: Permission denied (publickey).' }).details
        .reason
    ).toBe('authentication')
    expect(
      normalizeGitFailure({
        stderr: 'Your local changes to the following files would be overwritten by merge'
      }).details.reason
    ).toBe('local-changes')
  })
})
