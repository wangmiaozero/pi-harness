// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { restoreTransaction, contentHash } from './restore-transaction'
let root: string
let journal: string
const oldModels = '{"providers":{}}'
const newModels = '{"providers":{},"revision":2}'
const oldSettings = '{"revision":1}'
const newSettings = '{"revision":2}'
const prepare = () =>
  Promise.resolve(
    new Map([
      ['models.json', newModels],
      ['settings.json', newSettings]
    ])
  )
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-restore-txn-'))
  journal = path.join(root, 'recovery.json')
  await fs.writeFile(path.join(root, 'models.json'), oldModels)
  await fs.writeFile(path.join(root, 'settings.json'), oldSettings)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})
async function interrupted() {
  await fs.writeFile(path.join(root, 'models.json'), newModels)
  await fs.writeFile(
    journal,
    JSON.stringify({
      version: 1,
      id: 'test',
      directory: root,
      status: 'committing',
      files: [
        {
          name: 'models.json',
          before: oldModels,
          after: newModels,
          beforeHash: contentHash(oldModels),
          afterHash: contentHash(newModels)
        },
        {
          name: 'settings.json',
          before: oldSettings,
          after: newSettings,
          beforeHash: contentHash(oldSettings),
          afterHash: contentHash(newSettings)
        }
      ]
    })
  )
}
it('restores both versions and removes the sensitive staging record on success', async () => {
  await restoreTransaction(root, journal, 'test', prepare)
  expect(await fs.readFile(path.join(root, 'models.json'), 'utf8')).toBe(newModels)
  expect(await fs.readFile(path.join(root, 'settings.json'), 'utf8')).toBe(newSettings)
  await expect(fs.stat(journal)).rejects.toMatchObject({ code: 'ENOENT' })
})
it.each(['models.json', 'settings.json'])('rolls back a failure replacing %s', async (name) => {
  const rename = fs.rename.bind(fs)
  let injected = false
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(to) === path.join(root, name) && !injected) {
      injected = true
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    }
    return rename(from, to)
  })
  await expect(restoreTransaction(root, journal, 'test', prepare)).rejects.toThrow(
    'previous configuration was restored'
  )
  expect(await fs.readFile(path.join(root, 'models.json'), 'utf8')).toBe(oldModels)
  expect(await fs.readFile(path.join(root, 'settings.json'), 'utf8')).toBe(oldSettings)
  expect(JSON.parse(await fs.readFile(journal, 'utf8')).status).toBe('rolled-back')
})
it('recognizes an interrupted commit after restart and resumes only on explicit restore', async () => {
  await interrupted()
  const source = vi.fn(() => {
    throw new Error('source removed')
  })
  await restoreTransaction(root, journal, 'test', source)
  expect(source).not.toHaveBeenCalled()
  expect(await fs.readFile(path.join(root, 'settings.json'), 'utf8')).toBe(newSettings)
})
it('blocks a different restore while an interrupted one exists', async () => {
  await interrupted()
  await expect(restoreTransaction(root, journal, 'other', prepare)).rejects.toThrow('unfinished')
})
it('protects an external edit made after an interrupted commit', async () => {
  await interrupted()
  await fs.writeFile(path.join(root, 'settings.json'), '{"external":true}')
  await expect(restoreTransaction(root, journal, 'test', prepare)).rejects.toThrow(
    'changed since restore'
  )
  expect(await fs.readFile(path.join(root, 'settings.json'), 'utf8')).toBe('{"external":true}')
})
it.each(['corrupt', 'checksum'])('rejects a damaged journal: %s', async (mode) => {
  await interrupted()
  if (mode === 'corrupt') await fs.writeFile(journal, '{partial')
  else {
    const data = JSON.parse(await fs.readFile(journal, 'utf8'))
    data.files[1].after = '{"tampered":true}'
    await fs.writeFile(journal, JSON.stringify(data))
  }
  await expect(restoreTransaction(root, journal, 'test', prepare)).rejects.toThrow(
    /damaged|checksum/
  )
  expect(await fs.readFile(path.join(root, 'settings.json'), 'utf8')).toBe(oldSettings)
})
it('does not modify any target when preparation fails', async () => {
  await expect(
    restoreTransaction(root, journal, 'test', async () => {
      throw new Error('missing source')
    })
  ).rejects.toThrow('missing source')
  expect(await fs.readFile(path.join(root, 'models.json'), 'utf8')).toBe(oldModels)
})

it('keeps both targets intact when there is no space to persist preparation', async () => {
  const rename = fs.rename.bind(fs)
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(to) === journal) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    return rename(from, to)
  })
  await expect(restoreTransaction(root, journal, 'test', prepare)).rejects.toMatchObject({
    code: 'ENOSPC'
  })
  expect(await fs.readFile(path.join(root, 'models.json'), 'utf8')).toBe(oldModels)
  expect(await fs.readFile(path.join(root, 'settings.json'), 'utf8')).toBe(oldSettings)
})

it('retains a failed record when rollback itself fails and resumes explicitly', async () => {
  const rename = fs.rename.bind(fs)
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (
      to === path.join(root, 'settings.json') ||
      (to === path.join(root, 'models.json') &&
        (await fs.readFile(String(from), 'utf8')) === oldModels)
    )
      throw Object.assign(new Error('injected disk error'), { code: 'ENOSPC' })
    return rename(from, to)
  })
  await expect(restoreTransaction(root, journal, 'test', prepare)).rejects.toThrow('interrupted')
  expect(JSON.parse(await fs.readFile(journal, 'utf8')).status).toBe('failed')
  expect(await fs.readFile(path.join(root, 'models.json'), 'utf8')).toBe(newModels)
  vi.restoreAllMocks()
  await restoreTransaction(root, journal, 'test', prepare)
  expect(await fs.readFile(path.join(root, 'settings.json'), 'utf8')).toBe(newSettings)
})

it('finishes an all-files-written transaction without rewriting either target', async () => {
  await interrupted()
  await fs.writeFile(path.join(root, 'settings.json'), newSettings)
  const rename = vi.spyOn(fs, 'rename')
  await restoreTransaction(root, journal, 'test', prepare)
  expect(
    rename.mock.calls.filter(
      ([, to]) => to === path.join(root, 'models.json') || to === path.join(root, 'settings.json')
    )
  ).toHaveLength(0)
  await expect(fs.stat(journal)).rejects.toMatchObject({ code: 'ENOENT' })
})
