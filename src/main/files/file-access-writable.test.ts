import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileAccessService } from '../files/file-access-service'

describe('FileAccessService workspace write gate', () => {
  let directory = ''

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('denies writes inside a read-only workspace folder', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-harness-readonly-'))
    const writable = path.join(directory, 'main')
    const readonly = path.join(directory, 'ref')
    await mkdir(writable)
    await mkdir(readonly)
    await writeFile(path.join(writable, 'a.ts'), 'ok\n')
    await writeFile(path.join(readonly, 'b.ts'), 'no\n')
    const access = new FileAccessService()
    access.allowRoot(writable)
    access.allowRoot(readonly)
    access.setWorkspaceFolders([
      { resolvedPath: writable, readonly: false, exists: true },
      { resolvedPath: readonly, readonly: true, exists: true }
    ])

    await expect(access.assertWritable(path.join(writable, 'a.ts'), { mustExist: true })).resolves.toBe(
      await import('node:fs/promises').then((fs) => fs.realpath(path.join(writable, 'a.ts')))
    )
    await expect(access.assertWritable(path.join(readonly, 'b.ts'), { mustExist: true })).rejects.toMatchObject({
      code: 'PATH_DENIED'
    })
  })
})
