import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FileAccessService } from '../files/file-access-service'
import { GitService, summarizeStagedDiff } from './git-service'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  return stdout
}

describe('GitService', () => {
  let directory: string
  let service: GitService

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-harness-git-'))
    const access = {
      assertAllowed: vi.fn(async (target: string) => target),
      assertWritable: vi.fn(async (target: string) => target)
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

  it('stages, unstages, commits, and returns graph history', async () => {
    await git(directory, ['init'])
    await git(directory, ['config', 'user.name', 'Test User'])
    await git(directory, ['config', 'user.email', 'test@example.com'])
    const filePath = path.join(directory, 'feature.ts')
    await writeFile(filePath, 'export const feature = true\n')

    await service.stage(directory, [filePath])
    expect((await service.diff(directory, filePath)).patch).toContain('export const feature')
    const context = await service.commitMessageContext(directory)
    expect(context.summary).toContain('feature.ts')
    expect(context.summary).toContain('export const feature')

    await service.unstage(directory, [filePath])
    expect((await git(directory, ['diff', '--cached', '--name-only'])).trim()).toBe('')

    await service.stage(directory, [filePath])
    const committed = await service.commit(directory, 'feat: add feature flag')
    expect(committed.hash).toHaveLength(40)
    await expect(service.history(directory)).resolves.toMatchObject([
      {
        hash: committed.hash,
        parents: [],
        author: 'Test User',
        email: 'test@example.com',
        subject: 'feat: add feature flag'
      }
    ])
  })

  it('omits generated files and truncates oversized staged diff input', () => {
    const summary = summarizeStagedDiff(
      '2 files changed',
      [
        'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n+lock data',
        'diff --git a/src/app.ts b/src/app.ts\n+const ready = true'
      ].join('\n')
    )
    expect(summary).toContain('const ready = true')
    expect(summary).not.toContain('+lock data')
    expect(summary).toContain('pnpm-lock.yaml (generated or locked file)')
  })
})
