import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileAccessService } from './file-access-service'

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
})
