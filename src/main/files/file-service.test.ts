import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FileAccessService } from './file-access-service'
import { FileService } from './file-service'
import { TEXT_PREVIEW_MAX_BYTES } from '@shared/workspace/file-types'

describe('FileService', () => {
  let directory: string
  let service: FileService

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-harness-file-service-'))
    const access = {
      assertAllowed: vi.fn(async (target: string) => target)
    } as unknown as FileAccessService
    service = new FileService(access)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('lists hidden files, dependency directories, and generated content', async () => {
    await Promise.all([
      mkdir(path.join(directory, '.git')),
      mkdir(path.join(directory, 'node_modules')),
      mkdir(path.join(directory, 'dist')),
      writeFile(path.join(directory, '.env'), 'TOKEN=secret\n'),
      writeFile(path.join(directory, '.DS_Store'), ''),
      writeFile(path.join(directory, 'package.json'), '{}\n')
    ])

    const entries = await service.list(directory)

    expect(entries.map((entry) => entry.name)).toEqual([
      '.git',
      'dist',
      'node_modules',
      '.DS_Store',
      '.env',
      'package.json'
    ])
    expect(entries.filter((entry) => entry.isDirectory).map((entry) => entry.name)).toEqual([
      '.git',
      'dist',
      'node_modules'
    ])
  })

  it('returns the same text prefix without loading an oversized file into memory', async () => {
    const content = '你'.repeat(TEXT_PREVIEW_MAX_BYTES + 1024)
    const filePath = path.join(directory, 'large.txt')
    await writeFile(filePath, content)

    const preview = await service.readPreview(filePath)

    expect(preview.kind).toBe('text')
    if (preview.kind !== 'text') return
    expect(preview.text).toBe(content.slice(0, TEXT_PREVIEW_MAX_BYTES))
    expect(preview.truncated).toBe(true)
  })

  it('returns a revision and writes text when the file is unchanged', async () => {
    const filePath = path.join(directory, 'editable.ts')
    await writeFile(filePath, 'export const value = 1\n')

    const preview = await service.readPreview(filePath)

    expect(preview.kind).toBe('text')
    if (preview.kind !== 'text' || !preview.revision) return
    expect(preview.revision).toMatch(/^[a-f0-9]{64}$/)

    const result = await service.writeText(filePath, 'export const value = 2\n', preview.revision)

    expect(result).toMatchObject({ path: filePath, size: 23 })
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(result.revision).not.toBe(preview.revision)
    await expect(readFile(filePath, 'utf8')).resolves.toBe('export const value = 2\n')
  })

  it('rejects an external file change without overwriting it', async () => {
    const filePath = path.join(directory, 'conflict.txt')
    await writeFile(filePath, 'original')
    const preview = await service.readPreview(filePath)
    if (preview.kind !== 'text' || !preview.revision) throw new Error('Expected text preview')
    await writeFile(filePath, 'external change')

    await expect(
      service.writeText(filePath, 'local change', preview.revision)
    ).rejects.toMatchObject({
      code: 'FILE_CONFLICT'
    })
    await expect(readFile(filePath, 'utf8')).resolves.toBe('external change')
  })

  it('can explicitly overwrite an external file change', async () => {
    const filePath = path.join(directory, 'overwrite.txt')
    await writeFile(filePath, 'original')
    const preview = await service.readPreview(filePath)
    if (preview.kind !== 'text' || !preview.revision) throw new Error('Expected text preview')
    await writeFile(filePath, 'external change')

    await service.writeText(filePath, 'local change', preview.revision, true)

    await expect(readFile(filePath, 'utf8')).resolves.toBe('local change')
  })

  it('refuses to edit binary files', async () => {
    const filePath = path.join(directory, 'binary.dat')
    await writeFile(filePath, Buffer.from([1, 0, 2]))

    await expect(service.writeText(filePath, 'text', '0'.repeat(64))).rejects.toThrow(
      'Binary files cannot be edited'
    )
  })

  it.skipIf(process.platform === 'win32')('refuses to edit a symbolic link', async () => {
    const outside = path.join(
      path.dirname(directory),
      `${path.basename(directory)}-edit-target.txt`
    )
    const link = path.join(directory, 'linked.txt')
    await writeFile(outside, 'outside')
    await symlink(outside, link)

    try {
      await expect(service.writeText(link, 'replacement', '0'.repeat(64), true)).rejects.toThrow(
        'Refusing to edit a symbolic link'
      )
      await expect(readFile(outside, 'utf8')).resolves.toBe('outside')
    } finally {
      await rm(outside, { force: true })
    }
  })

  it('returns ICO files as renderable image previews', async () => {
    const filePath = path.join(directory, 'favicon.ico')
    const content = Buffer.from([0, 0, 1, 0, 0, 0])
    await writeFile(filePath, content)

    const preview = await service.readPreview(filePath)

    expect(preview).toMatchObject({
      kind: 'image',
      name: 'favicon.ico',
      mime: 'image/vnd.microsoft.icon',
      base64: content.toString('base64')
    })
  })

  it('preserves an existing file when overwrite is disabled', async () => {
    const filePath = path.join(directory, 'existing.txt')
    await writeFile(filePath, 'original')

    await expect(
      service.upload(directory, 'existing.txt', Buffer.from('replacement').toString('base64'))
    ).rejects.toThrow('File already exists')
    await expect(readFile(filePath, 'utf8')).resolves.toBe('original')
  })

  it('keeps lexical root validation separate from the canonical write path', async () => {
    const requestedDirectory = '/var/folders/project'
    const requestedTarget = path.join(requestedDirectory, 'uploaded.txt')
    const assertAllowed = vi.fn(async (target: string, options?: { mustExist?: boolean }) => {
      if (target === requestedDirectory && options?.mustExist) return directory
      return target
    })
    service = new FileService({ assertAllowed } as unknown as FileAccessService)

    const result = await service.upload(
      requestedDirectory,
      'uploaded.txt',
      Buffer.from('uploaded').toString('base64')
    )

    expect(assertAllowed).toHaveBeenNthCalledWith(1, requestedTarget)
    expect(assertAllowed).toHaveBeenNthCalledWith(2, requestedDirectory, { mustExist: true })
    expect(result.path).toBe(path.join(directory, 'uploaded.txt'))
    await expect(readFile(result.path, 'utf8')).resolves.toBe('uploaded')
  })

  it('rejects path-like file names even when called outside IPC', async () => {
    await expect(service.upload(directory, '../outside.txt', '')).rejects.toThrow(
      'Invalid upload file name'
    )
  })

  it('does not overwrite a non-file filesystem entry', async () => {
    await mkdir(path.join(directory, 'nested'))
    await expect(
      service.upload(directory, 'nested', Buffer.from('data').toString('base64'), true)
    ).rejects.toThrow('Upload target is not a file')
  })

  it.skipIf(process.platform === 'win32')(
    'does not follow a symbolic link when overwriting an upload',
    async () => {
      const outside = path.join(path.dirname(directory), `${path.basename(directory)}-outside.txt`)
      const link = path.join(directory, 'linked.txt')
      await writeFile(outside, 'outside')
      await symlink(outside, link)

      try {
        await expect(
          service.upload(
            directory,
            'linked.txt',
            Buffer.from('replacement').toString('base64'),
            true
          )
        ).rejects.toThrow('Refusing to overwrite a symbolic link')
        await expect(readFile(outside, 'utf8')).resolves.toBe('outside')
      } finally {
        await rm(outside, { force: true })
      }
    }
  )
})
