// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const fixture = vi.hoisted(() => ({ watch: vi.fn(), close: vi.fn(async () => {}), on: vi.fn() }))
vi.mock('chokidar', () => ({ watch: fixture.watch }))
import { WorkspaceWatcherService } from './workspace-watcher-service'
let directory: string | undefined
afterEach(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true })
  vi.clearAllMocks()
})
it('excludes ignored runtime/cache/package directories before allocating filesystem watchers', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-watch-'))
  await fs.writeFile(
    path.join(directory, '.gitignore'),
    'resources/runtimes/\n.runtime-cache/\ntask/\nrelease/\n'
  )
  fixture.watch.mockReturnValue({ on: fixture.on, close: fixture.close })
  const watcher = new WorkspaceWatcherService()
  await watcher.sync([directory])
  expect(fixture.watch.mock.calls[0][1].followSymlinks).toBe(false)
  const ignored = fixture.watch.mock.calls[0][1].ignored as (
    file: string,
    stat?: { isDirectory: () => boolean }
  ) => boolean
  expect(ignored(path.join(directory, 'resources', 'runtimes'))).toBe(true)
  expect(ignored(path.join(directory, '.runtime-cache'))).toBe(true)
  expect(ignored(path.join(directory, 'task', 'generated'))).toBe(true)
  expect(ignored(path.join(directory, 'release'))).toBe(true)
  expect(ignored(path.join(directory, 'node_modules'))).toBe(true)
  expect(ignored(path.join(directory, 'src', 'main.ts'), { isDirectory: () => false })).toBe(false)
  expect(
    ignored(path.join(directory, 'resources', 'desktop-extension'), { isDirectory: () => true })
  ).toBe(false)
  await watcher.close()
  expect(fixture.close).toHaveBeenCalledOnce()
})
