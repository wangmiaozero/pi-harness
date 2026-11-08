// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const fixture = vi.hoisted(() => ({ watch: vi.fn(), close: vi.fn() }))
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  watch: fixture.watch
}))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    // Filesystem timestamps can lag the process clock. Keep real file identity
    // and mutations, while deterministically reproducing the clock boundary.
    lstat: async (file: string) => {
      const stat = await actual.lstat(file)
      stat.ctimeMs -= 60_000
      stat.mtimeMs -= 60_000
      return stat
    }
  }
})
import { watchNativeWorkspace } from './native-workspace-watcher'
import { WorkspaceWatcherService } from './workspace-watcher-service'

let directory: string | undefined
let watcher: ReturnType<typeof watchNativeWorkspace> | undefined
afterEach(async () => {
  await watcher?.close()
  vi.useRealTimers()
  if (directory) await fs.rm(directory, { recursive: true, force: true })
  watcher = undefined
  vi.clearAllMocks()
})

async function start() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-watch-clock-'))
  const file = path.join(directory, 'main.ts')
  await fs.writeFile(file, 'before\n')
  fixture.watch.mockReturnValue({ on: vi.fn(), close: fixture.close })
  const changed = vi.fn()
  const failed = vi.fn()
  watcher = watchNativeWorkspace(directory, () => false, changed, failed)
  await watcher.ready
  const emit = (filename: string) => fixture.watch.mock.calls.at(-1)![2]('change', filename)
  vi.useFakeTimers()
  return { file, changed, failed, emit }
}

it('delivers the first live edit even when file timestamps precede the process clock', async () => {
  const { file, changed, failed, emit } = await start()
  await fs.writeFile(file, 'first live edit\n')
  emit('main.ts')
  await vi.advanceTimersByTimeAsync(250)
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(failed).not.toHaveBeenCalled()
})

it('suppresses unchanged startup replays without losing a subsequent edit or removal', async () => {
  const { file, changed, emit } = await start()
  emit('main.ts')
  await vi.advanceTimersByTimeAsync(250)
  await vi.waitFor(() => expect(fixture.watch).toHaveBeenCalledOnce())
  expect(changed).not.toHaveBeenCalled()
  await fs.writeFile(file, 'live edit after replay\n')
  emit('main.ts')
  await vi.advanceTimersByTimeAsync(250)
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
  changed.mockClear()
  await fs.unlink(file)
  emit('main.ts')
  await vi.advanceTimersByTimeAsync(250)
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
})

it('delivers a child edit when macOS reports only the parent directory', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-watch-dir-'))
  const source = path.join(directory, 'src')
  await fs.mkdir(source)
  const file = path.join(source, 'main.ts')
  await fs.writeFile(file, 'before\n')
  fixture.watch.mockReturnValue({ on: vi.fn(), close: fixture.close })
  const changed = vi.fn()
  watcher = watchNativeWorkspace(directory, () => false, changed, vi.fn())
  await watcher.ready
  const emit = (filename: string) => fixture.watch.mock.calls.at(-1)![2]('change', filename)
  vi.useFakeTimers()
  emit('src')
  await vi.advanceTimersByTimeAsync(250)
  expect(changed).not.toHaveBeenCalled()
  await fs.writeFile(file, 'after\n')
  emit('src')
  await vi.advanceTimersByTimeAsync(250)
  expect(changed).toHaveBeenCalledOnce()
})

it('delivers an edit reported with the resolved filesystem path', async () => {
  const { file, changed, emit } = await start()
  await fs.writeFile(file, 'resolved path edit\n')
  emit(await fs.realpath(file))
  await vi.advanceTimersByTimeAsync(250)
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
})

it('drops events from outside the workspace', async () => {
  const { changed, emit } = await start()
  emit(path.join(path.parse(directory!).root, 'outside.ts'))
  await vi.advanceTimersByTimeAsync(250)
  expect(changed).not.toHaveBeenCalled()
})

it('cancels queued notifications when the native subscription closes', async () => {
  const { file, changed, emit } = await start()
  await fs.writeFile(file, 'queued edit\n')
  emit('main.ts')
  await watcher!.close()
  await vi.advanceTimersByTimeAsync(500)
  expect(changed).not.toHaveBeenCalled()
  expect(fixture.close).toHaveBeenCalledOnce()
})

it('reports a recursive stream that never delivers and removes the probe file', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-watch-silent-'))
  fixture.watch.mockReturnValue({ on: vi.fn(), close: fixture.close })
  const failed = vi.fn()
  watcher = watchNativeWorkspace(directory, () => false, vi.fn(), failed, true, {
    proveDelivery: true,
    proveTimeoutMs: 40
  })
  await expect(watcher.ready).rejects.toMatchObject({ code: 'WATCH_SILENT' })
  expect(await fs.readdir(directory)).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/^\.pi-harness-watch-/)])
  )
  expect(failed).not.toHaveBeenCalled()
})

it('treats the delivery probe as private and still resolves once it is reported', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-watch-probe-'))
  directory = root
  let listener: ((event: string, filename: string) => void) | undefined
  fixture.watch.mockImplementation((_root: string, _options: unknown, onEvent: Function) => {
    listener = onEvent as (event: string, filename: string) => void
    return { on: vi.fn(), close: fixture.close }
  })
  const changed = vi.fn()
  watcher = watchNativeWorkspace(root, () => false, changed, vi.fn(), true, {
    proveDelivery: true,
    proveTimeoutMs: 1000
  })
  await vi.waitFor(async () => {
    expect((await fs.readdir(root)).some((name) => name.startsWith('.pi-harness-watch-'))).toBe(
      true
    )
  })
  const canary = (await fs.readdir(root)).find((name) => name.startsWith('.pi-harness-watch-'))
  listener!('rename', canary!)
  await watcher.ready
  expect(changed).not.toHaveBeenCalled()
  expect((await fs.readdir(root)).some((name) => name.startsWith('.pi-harness-watch-'))).toBe(false)
})

it('allows a failed native subscription to be retried for the same workspace', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-watch-retry-'))
  const error = Object.assign(new Error('fixture watch failure'), { code: 'EMFILE' })
  fixture.watch.mockImplementationOnce(() => {
    throw error
  })
  fixture.watch.mockImplementation((watched: string, _options: unknown, listener: Function) => {
    const timer = setInterval(() => {
      void fs.readdir(watched).then((names) => {
        const canary = names.find((name) => name.startsWith('.pi-harness-watch-'))
        if (!canary) return
        clearInterval(timer)
        listener('rename', canary)
      })
    }, 10)
    return {
      on: vi.fn(),
      close: () => {
        clearInterval(timer)
        fixture.close()
      }
    }
  })
  const service = new WorkspaceWatcherService('darwin')
  try {
    await expect(service.sync([directory])).rejects.toBe(error)
    await service.sync([directory])
    await service.ready()
    expect(fixture.watch).toHaveBeenCalledTimes(2)
  } finally {
    await service.close()
  }
})
