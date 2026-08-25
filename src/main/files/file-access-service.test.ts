import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileAccessService } from './file-access-service'
import { JsonStore } from '../services/storage'

describe.skipIf(process.platform === 'win32')('FileAccessService canonical roots', () => {
  let physicalRoot = ''
  let linkedRoot = ''

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
