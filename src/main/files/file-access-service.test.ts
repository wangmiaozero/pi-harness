import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileAccessService } from './file-access-service'
import { JsonStore } from '../services/storage'
import { toSlashPath } from '@shared/workspace/paths'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('FileAccessService concurrent root reads', () => {
  it('includes a Main grant made while persisted roots are loading and shares the scan', async () => {
    const persisted = deferred<{ roots: string[] }>()
    const reading = deferred<void>()
    const store = new JsonStore('/unused/authorized-roots.json', { roots: [] as string[] })
    const read = vi.spyOn(store, 'read').mockImplementation(() => {
      reading.resolve()
      return persisted.promise
    })
    const access = new FileAccessService(store)
    const list = vi.fn().mockResolvedValue([])
    access.attachSessionLister(list)
    const granted = path.join(tmpdir(), 'pi-harness-managed-root')
    const checks = Promise.all([
      expect(access.assertAllowed(granted)).resolves.toBe(granted),
      expect(access.assertAllowed(granted)).resolves.toBe(granted)
    ])
    await reading.promise
    access.allowRoot(granted)
    persisted.resolve({ roots: [] })

    await checks
    await expect(access.assertAllowed(`${granted}-unknown`)).rejects.toMatchObject({
      code: 'PATH_DENIED'
    })
    expect(list).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not publish a stale scan after invalidation', async () => {
    const oldSessions = deferred<never[]>()
    const access = new FileAccessService()
    const currentRoot = path.join(tmpdir(), 'pi-harness-current-project')
    const list = vi
      .fn()
      .mockReturnValueOnce(oldSessions.promise)
      .mockResolvedValue([{ cwd: currentRoot }])
    access.attachSessionLister(list)
    const first = access.getAllowedRoots()
    access.invalidate()
    const current = await access.getAllowedRoots()
    oldSessions.resolve([])

    expect(await first).toBe(current)
    expect(await access.getAllowedRoots()).toBe(current)
    expect(current.has(toSlashPath(currentRoot))).toBe(true)
    expect(list).toHaveBeenCalledTimes(2)
  })
})

describe.skipIf(process.platform === 'win32')('FileAccessService canonical roots', () => {
  let physicalRoot = ''
  let linkedRoot = ''

  it('allows new nested files but rejects symlink escapes and aliases into read-only folders', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'pi-harness-write-guard-'))
    const writable = path.join(base, 'writable'),
      readonly = path.join(base, 'readonly'),
      outside = path.join(base, 'outside')
    await Promise.all([mkdir(writable), mkdir(readonly), mkdir(outside)])
    try {
      const access = new FileAccessService()
      access.allowRoot(writable)
      access.allowRoot(readonly)
      const folders = [
        { resolvedPath: writable, exists: true, readonly: false },
        { resolvedPath: readonly, exists: true, readonly: true }
      ]
      const nested = path.join(writable, 'new', 'file.txt')
      await expect(access.assertWritableInFolders(nested, folders)).resolves.toBe(
        path.join(await realpath(writable), 'new', 'file.txt')
      )
      await symlink(outside, path.join(writable, 'escape'), 'dir')
      await symlink(readonly, path.join(writable, 'reference'), 'dir')
      for (const alias of ['escape', 'reference']) {
        await expect(
          access.assertWritableInFolders(path.join(writable, alias, 'new', 'file.txt'), folders)
        ).rejects.toMatchObject({ code: 'PATH_DENIED' })
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  afterEach(async () => {
    if (linkedRoot) await rm(linkedRoot, { force: true })
    if (physicalRoot) await rm(physicalRoot, { recursive: true, force: true })
  })

  it('accepts canonical child paths returned from a symlinked allowed root', async () => {
    physicalRoot = await mkdtemp(path.join(tmpdir(), 'pi-harness-physical-root-'))
    linkedRoot = `${physicalRoot}-link`
    const filePath = path.join(physicalRoot, 'file.txt')
    await writeFile(filePath, 'content')
    await symlink(physicalRoot, linkedRoot, 'dir')
    const canonicalFilePath = await realpath(filePath)

    const access = new FileAccessService()
    access.allowRoot(linkedRoot)

    await expect(access.assertAllowed(canonicalFilePath, { mustExist: true })).resolves.toBe(
      canonicalFilePath
    )
  })

  it('persists explicit grants and refuses to restore unknown roots', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'pi-harness-authorized-roots-'))
    const chosen = path.join(base, 'chosen')
    const unknown = path.join(base, 'unknown')
    const storePath = path.join(base, 'authorized-roots.json')
    await Promise.all([mkdir(chosen), mkdir(unknown)])
    try {
      const firstStore = new JsonStore(storePath, { roots: [] })
      const first = new FileAccessService(firstStore)
      await expect(first.restoreRoot(unknown)).rejects.toMatchObject({ code: 'PATH_DENIED' })
      const canonical = await first.authorizeRoot(chosen)
      expect(first.getActiveRoot()).toBe(canonical)

      const restored = new FileAccessService(new JsonStore(storePath, { roots: [] }))
      await expect(restored.restoreRoot(chosen)).resolves.toBe(canonical)
      expect(restored.getActiveRoot()).toBe(canonical)
      await expect(restored.restoreRoot(unknown)).rejects.toMatchObject({ code: 'PATH_DENIED' })
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
