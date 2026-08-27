import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FileAccessService } from '../files/file-access-service'
import { GitService } from './git-service'

describe('GitService', () => {
  let directory: string
  let service: GitService

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-harness-git-'))
    const access = {
      assertAllowed: vi.fn(async (target: string) => target)
    } as unknown as FileAccessService
    service = new GitService(access)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('returns a non-repository status instead of throwing', async () => {
    await expect(service.status(directory)).resolves.toEqual({
      isGitRepository: false,
      repositoryRoot: null,
      files: [],
      additions: 0,
      deletions: 0
    })
  })
})
