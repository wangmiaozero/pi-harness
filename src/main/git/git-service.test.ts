import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  let remoteDirectory: string | null
  let cloneDirectory: string | null
  let service: GitService

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-harness-git-'))
    remoteDirectory = null
    cloneDirectory = null
    const access = {
      assertAllowed: vi.fn(async (target: string) => target),
      assertWritable: vi.fn(async (target: string) => target)
    } as unknown as FileAccessService
    service = new GitService(access)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
    if (remoteDirectory) await rm(remoteDirectory, { recursive: true, force: true })
    if (cloneDirectory) await rm(cloneDirectory, { recursive: true, force: true })
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

  it('supports branch workflow, stash, repository overview, and commit review', async () => {
    await git(directory, ['init', '-b', 'main'])
    await git(directory, ['config', 'user.name', 'Test User'])
    await git(directory, ['config', 'user.email', 'test@example.com'])
    const readme = path.join(directory, 'README.md')
    await writeFile(readme, '# Repository\n')
    await service.stage(directory, [readme])
    await service.commit(directory, 'docs: initialize repository')

    await service.action({ cwd: directory, action: 'create-branch', name: 'feature/review' })
    const feature = path.join(directory, 'feature.ts')
    await writeFile(feature, 'export const review = true\n')
    await service.stage(directory, [feature])
    const featureCommit = await service.commit(directory, 'feat: add history review')

    await service.action({ cwd: directory, action: 'checkout-branch', target: 'main' })
    await service.action({ cwd: directory, action: 'merge', target: 'feature/review' })
    const overview = await service.overview(directory)
    expect(overview.currentBranch).toBe('main')
    expect(overview.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'main', type: 'local', current: true }),
        expect.objectContaining({ name: 'feature/review', type: 'local', current: false })
      ])
    )
    expect(overview.pullRequests.provider).toBeNull()

    const details = await service.commitDetails(directory, featureCommit.hash)
    expect(details.subject).toBe('feat: add history review')
    expect(details.files).toContainEqual({ status: 'A', path: 'feature.ts', previousPath: null })
    await expect(service.commitDiff(directory, featureCommit.hash, 'feature.ts')).resolves.toMatchObject({
      truncated: false,
      patch: expect.stringContaining('export const review = true')
    })

    await writeFile(feature, 'export const review = false\n')
    await service.action({ cwd: directory, action: 'stash', message: 'review work' })
    expect((await service.overview(directory)).stashCount).toBe(1)
    await service.action({ cwd: directory, action: 'stash-pop' })
    expect(await readFile(feature, 'utf8')).toContain('false')
  })

  it('pushes a new upstream, fetches remote changes, and pulls fast-forward only', async () => {
    remoteDirectory = await mkdtemp(path.join(tmpdir(), 'pi-harness-remote-'))
    cloneDirectory = await mkdtemp(path.join(tmpdir(), 'pi-harness-clone-'))
    await git(remoteDirectory, ['init', '--bare'])
    await git(directory, ['init', '-b', 'main'])
    await git(directory, ['config', 'user.name', 'Test User'])
    await git(directory, ['config', 'user.email', 'test@example.com'])
    const readme = path.join(directory, 'README.md')
    await writeFile(readme, '# Push and pull\n')
    await service.stage(directory, [readme])
    await service.commit(directory, 'docs: initialize remote workflow')
    await git(directory, ['remote', 'add', 'origin', remoteDirectory])

    await service.action({ cwd: directory, action: 'push' })
    expect((await git(directory, ['rev-parse', '--abbrev-ref', '@{upstream}'])).trim()).toBe(
      'origin/main'
    )

    await git(remoteDirectory, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
    await git(cloneDirectory, ['clone', remoteDirectory, '.'])
    await git(cloneDirectory, ['config', 'user.name', 'Remote User'])
    await git(cloneDirectory, ['config', 'user.email', 'remote@example.com'])
    const remoteFile = path.join(cloneDirectory, 'remote.ts')
    await writeFile(remoteFile, 'export const remote = true\n')
    await git(cloneDirectory, ['add', 'remote.ts'])
    await git(cloneDirectory, ['commit', '-m', 'feat: add remote change'])
    await git(cloneDirectory, ['push'])

    await service.action({ cwd: directory, action: 'fetch' })
    expect(
      (await service.overview(directory)).branches.find((branch) => branch.name === 'main')?.behind
    ).toBe(1)
    await service.action({ cwd: directory, action: 'pull' })
    expect(await readFile(path.join(directory, 'remote.ts'), 'utf8')).toContain('remote = true')
  })
})
