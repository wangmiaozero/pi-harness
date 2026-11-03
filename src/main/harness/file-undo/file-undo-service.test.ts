import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileUndoService, type FileUndoRecord } from './file-undo-service'
import { FileService } from '../../files/file-service'
import type { FileAccessService } from '../../files/file-access-service'
import { JsonStore } from '../../services/storage'

describe('turn file undo', () => {
  let directory: string
  let store: JsonStore<FileUndoRecord>
  let service: FileUndoService
  let authorize: ReturnType<typeof vi.fn<(sessionId: string, target: string) => Promise<string>>>
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-turn-undo-'))
    store = new JsonStore(path.join(directory, 'undo.json'), { runs: [] })
    authorize = vi.fn(async (sessionId: string, target: string) => {
      if (sessionId !== 'session' || path.dirname(target) !== directory) throw new Error('Denied')
      return target
    })
    service = new FileUndoService(
      store,
      new FileService({
        assertWritable: (target: string) => authorize('session', target)
      } as unknown as FileAccessService),
      authorize
    )
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  async function edit(name: string, before: string | null, after: string) {
    const file = path.join(directory, name)
    if (before !== null) await writeFile(file, before)
    await service.capture('session', 'run', file, 'write', { content: after })
    await writeFile(file, after)
    return file
  }
  it('restores exact pre-turn text across repeated edits and restart, and removes only verified new files', async () => {
    const file = await edit('one.ts', 'user edits before turn\n', 'intermediate\n')
    await service.capture('session', 'run', file, 'edit', {
      oldText: 'intermediate',
      newText: 'final'
    })
    await writeFile(file, 'final\n')
    const created = await edit('new.ts', null, 'created\n')
    expect((await service.status('session', 'run')).available).toBe(false)
    await service.seal('session', 'run')
    const reloaded = new FileUndoService(
      store,
      new FileService({
        assertWritable: (target: string) => authorize('session', target)
      } as unknown as FileAccessService),
      authorize
    )
    expect(await reloaded.undo('session', 'run')).toMatchObject({
      undone: true,
      remainingCount: 0,
      fileCount: 2
    })
    expect(await readFile(file, 'utf8')).toBe('user edits before turn\n')
    await expect(readFile(created)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await reloaded.undo('session', 'run')).toMatchObject({ undone: true })
  })
  it('preflights the whole batch and preserves all files when a later target has changed', async () => {
    const first = await edit('one.ts', 'before', 'after')
    const second = await edit('two.ts', 'before2', 'after2')
    await service.seal('session', 'run')
    await writeFile(second, 'later user edit')
    await expect(service.undo('session', 'run')).rejects.toThrow('changed after')
    expect(await readFile(first, 'utf8')).toBe('after')
    expect(await readFile(second, 'utf8')).toBe('later user edit')
  })
  it('rejects another session and rechecks authorization before restoring', async () => {
    const file = await edit('one.ts', 'before', 'after')
    await service.seal('session', 'run')
    await expect(service.undo('other', 'run')).rejects.toThrow('No verified')
    authorize.mockRejectedValue(new Error('Read only'))
    await expect(service.undo('session', 'run')).rejects.toThrow('Read only')
    expect(await readFile(file, 'utf8')).toBe('after')
  })
  it('refuses unsupported edits and unverified tool results without blocking execution', async () => {
    const file = path.join(directory, 'one.ts')
    await writeFile(file, 'same same')
    await service.capture('session', 'run', file, 'edit', { oldText: 'same', newText: 'new' })
    await service.seal('session', 'run')
    expect((await service.status('session', 'run')).available).toBe(false)
    await service.capture('session', 'run2', file, 'write', { content: 'expected' })
    await service.seal('session', 'run2')
    expect((await service.status('session', 'run2')).available).toBe(false)
  })
  it('refuses symlink, outside root, binary and oversized snapshots', async () => {
    const target = path.join(directory, 'actual')
    await writeFile(target, 'before')
    const link = path.join(directory, 'link')
    await symlink(target, link)
    const binary = path.join(directory, 'binary')
    const large = path.join(directory, 'large')
    await writeFile(binary, Buffer.from([0, 1]))
    await writeFile(large, 'x'.repeat(2 * 1024 * 1024 + 1))
    for (const [i, file] of [
      link,
      path.join(directory, '..', 'outside'),
      binary,
      large
    ].entries()) {
      await service.capture('session', `unsafe${i}`, file, 'write', { content: 'after' })
      await service.seal('session', `unsafe${i}`)
      expect((await service.status('session', `unsafe${i}`)).available).toBe(false)
    }
    expect(await readFile(target, 'utf8')).toBe('before')
  })
})
