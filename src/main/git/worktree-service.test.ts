import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FileAccessService } from '../files/file-access-service'
import { WorktreeService } from './worktree-service'

describe('WorktreeService', () => {
  let directory: string
  let service: WorktreeService

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-harness-worktree-'))
    const access = {
      assertAllowed: vi.fn(async (target: string) => target)
    } as unknown as FileAccessService
    service = new WorktreeService(access)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('returns an empty list when the folder is not a git repository', async () => {
    await expect(service.list(directory)).resolves.toEqual([])
  })

  it('resolves a non-git folder as a plain project', async () => {
    await expect(service.resolveProject(directory)).resolves.toEqual({
      projectRoot: directory,
      branch: null,
      isWorktree: false,
      isTopLevel: false
    })
  })
})
