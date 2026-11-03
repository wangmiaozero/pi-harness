// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WorkspaceWatcherService } from './workspace-watcher-service'

describe.each(process.platform === 'darwin' ? (['darwin', 'linux'] as const) : [process.platform])(
  'WorkspaceWatcherService (%s backend)',
  (platform) => {
    let directory = ''
    let service: WorkspaceWatcherService | null = null

    async function startWatching(root: string): Promise<void> {
      service = new WorkspaceWatcherService(platform)
      await service.sync([root])
      await service.ready()
    }

    afterEach(async () => {
      await service?.close()
      if (directory) await rm(directory, { recursive: true, force: true })
    })

    it('keeps home config edits live without subscribing to app state or nested home trees', async () => {
      directory = await mkdtemp(path.join(tmpdir(), 'workspace-home-'))
      const home = path.join(directory, 'home')
      const state = path.join(home, 'AppData', 'Roaming', 'Pi-Harness')
      const project = path.join(home, 'project', 'src')
      const pi = path.join(home, '.pi', 'agent', 'sessions')
      await Promise.all([state, project, pi].map((folder) => mkdir(folder, { recursive: true })))
      const config = path.join(home, '.bashrc')
      const nested = [
        path.join(state, 'settings.json'),
        path.join(pi, 'session.jsonl'),
        path.join(project, 'main.ts')
      ]
      await Promise.all([config, ...nested].map((file) => writeFile(file, 'before')))
      service = new WorkspaceWatcherService(platform, {
        homeDirectory: home,
        excludedDirectories: [state]
      })
      await service.sync([home])
      await service.ready()
      const changed = vi.fn()
      service.onChange(changed)
      await Promise.all(nested.map((file) => writeFile(file, 'after')))
      await new Promise((resolve) => setTimeout(resolve, 700))
      expect(changed).not.toHaveBeenCalled()
      await writeFile(config, 'updated config')
      await vi.waitFor(() => expect(changed).toHaveBeenCalledWith([home]), { timeout: 3000 })

      // A separately selected project still gets recursive live updates.
      const projectRoot = path.dirname(project)
      await service.sync([projectRoot])
      await service.ready()
      changed.mockClear()
      await writeFile(nested[2]!, 'explicit project edit')
      await vi.waitFor(() => expect(changed).toHaveBeenCalledWith([projectRoot]), { timeout: 3000 })
    })

    it('ignores continuous application writes under an ordinary ancestor workspace', async () => {
      directory = await mkdtemp(path.join(tmpdir(), 'workspace-app-state-'))
      const state = path.join(directory, 'custom-state')
      await mkdir(state)
      const stateFile = path.join(state, 'settings.json')
      const source = path.join(directory, 'main.ts')
      await Promise.all([stateFile, source].map((file) => writeFile(file, 'before')))
      service = new WorkspaceWatcherService(platform, { excludedDirectories: [state] })
      await service.sync([directory])
      await service.ready()
      const changed = vi.fn()
      service.onChange(changed)
      // Establish an acknowledged live edit before measuring continuous writes;
      // native FSEvents may replay directory creation from fixture setup.
      await writeFile(source, 'watcher live')
      await vi.waitFor(() => expect(changed).toHaveBeenCalledWith([directory]), { timeout: 3000 })
      changed.mockClear()
      for (let index = 0; index < 6; index++) {
        await writeFile(stateFile, String(index))
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect(changed).not.toHaveBeenCalled()
      await writeFile(source, 'source edit')
      await vi.waitFor(() => expect(changed).toHaveBeenCalledWith([directory]), { timeout: 3000 })
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
      await startWatching(root)
      service!.onChange(changed)

      for (const folder of [...excluded, external])
        await writeFile(path.join(folder, 'ignored.ts'), 'ignored')
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect(changed).not.toHaveBeenCalled()

      await writeFile(file, 'after\n')
      await vi.waitFor(() => expect(changed).toHaveBeenCalledWith([root]), { timeout: 3000 })
      for (const folder of [skills, ordinaryWorktrees]) {
        changed.mockClear()
        await writeFile(path.join(folder, 'visible.ts'), 'visible')
        await vi.waitFor(() => expect(changed).toHaveBeenCalledWith([root]), { timeout: 3000 })
      }
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

      await startWatching(root)
      const changed = vi.fn()
      service!.onChange(changed)

      await writeFile(file, 'after\n')
      await vi.waitFor(() => expect(changed).toHaveBeenCalledWith([root]), { timeout: 3000 })
    })

    it.runIf(platform === 'darwin')(
      'keeps descriptors bounded for thousands of assets and still delivers edits, additions, renames and removals',
      async () => {
        directory = await mkdtemp(path.join(tmpdir(), 'workspace-assets-'))
        const assets = path.join(directory, 'resources', 'petpacks')
        await mkdir(assets, { recursive: true })
        for (let batch = 0; batch < 32; batch++)
          await Promise.all(
            Array.from({ length: 64 }, (_, index) =>
              writeFile(path.join(assets, `${batch * 64 + index}.webp`), 'fixture')
            )
          )
        const before = (await readdir('/dev/fd')).length
        await startWatching(directory)
        const after = (await readdir('/dev/fd')).length
        expect(after - before).toBeLessThan(32)
        await expect(promisify(execFile)('/usr/bin/true')).resolves.toMatchObject({ stdout: '' })
        const changed = vi.fn()
        service!.onChange(changed)
        const original = path.join(assets, '0.webp')
        const added = path.join(assets, 'new.webp')
        const moved = path.join(assets, 'renamed.webp')
        for (const operation of [
          () => writeFile(original, 'updated asset'),
          () => writeFile(added, 'new asset'),
          () => rename(added, moved),
          () => unlink(moved)
        ]) {
          changed.mockClear()
          await operation()
          await vi.waitFor(() => expect(changed).toHaveBeenCalledWith([directory]), {
            timeout: 3000
          })
        }
        await service!.sync([])
        const closed = (await readdir('/dev/fd')).length
        expect(closed - before).toBeLessThan(8)
      }
    )
  }
)
