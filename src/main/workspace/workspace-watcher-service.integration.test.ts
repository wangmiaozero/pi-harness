// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FSWatcher } from 'chokidar'
import { WorkspaceWatcherService } from './workspace-watcher-service'

describe('WorkspaceWatcherService', () => {
  let directory = ''
  let service: WorkspaceWatcherService | null = null

  async function startWatching(root: string): Promise<FSWatcher> {
    service = new WorkspaceWatcherService()
    await service.sync([root])
    const watcher = [
      ...(service as unknown as { watchers: Map<string, FSWatcher> }).watchers.values()
    ][0]!
    await once(watcher, 'ready')
    return watcher
  }

  afterEach(async () => {
    await service?.close()
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('keeps nested agent worktrees, build caches, and linked trees outside the live watch scope', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'workspace-watcher-'))
    const root = path.join(directory, 'project')
    const source = path.join(root, 'src')
    const skills = path.join(root, '.claude', 'skills', 'local')
    const ordinaryWorktrees = path.join(root, 'worktrees', 'source')
    const external = path.join(directory, 'external', 'source')
    const excluded = [
      path.join(root, '.claude', 'worktrees', 'agent', 'src'),
      path.join(root, '.codex', 'worktrees', 'agent', 'src'),
      path.join(root, '.worktrees', 'agent', 'src'),
      path.join(root, '.gocache', 'hash', 'cache'),
      path.join(root, '.gotmp', 'build', 'cache'),
      path.join(root, 'generated', 'cache')
    ]
    await Promise.all(
      [source, skills, ordinaryWorktrees, external, ...excluded].map((folder) =>
        mkdir(folder, { recursive: true })
      )
    )
    await writeFile(path.join(root, '.gitignore'), 'generated/\n')
    await symlink(
      path.dirname(external),
      path.join(root, 'linked-project'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    const file = path.join(source, 'main.ts')
    await writeFile(file, 'before\n')
    const changed = vi.fn()
    const watcher = await startWatching(root)
    service!.onChange(changed)

    const watched = Object.keys(watcher.getWatched())
    expect(watched).toContain(source)
    expect(watched).toContain(skills)
    expect(watched).toContain(ordinaryWorktrees)
    for (const folder of excluded) expect(watched).not.toContain(folder)
    expect(watched).not.toContain(path.join(root, 'linked-project', 'source'))
    expect(watched).not.toContain(external)

    await writeFile(file, 'after\n')
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith([root]), { timeout: 3000 })
  })

  it.each([
    '.claude/worktrees/agent',
    '.codex/worktrees/agent',
    '.worktrees/agent',
    '.gocache',
    '.gotmp'
  ])('watches an explicitly opened %s root and delivers file changes', async (relativeRoot) => {
    directory = await mkdtemp(path.join(tmpdir(), 'workspace-watcher-root-'))
    const root = path.join(directory, relativeRoot)
    const source = path.join(root, 'src')
    await mkdir(source, { recursive: true })
    const file = path.join(source, 'main.ts')
    await writeFile(file, 'before\n')

    const watcher = await startWatching(root)
    expect(Object.keys(watcher.getWatched())).toContain(source)
    const changed = vi.fn()
    service!.onChange(changed)

    await writeFile(file, 'after\n')
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith([root]), { timeout: 3000 })
  })
})
