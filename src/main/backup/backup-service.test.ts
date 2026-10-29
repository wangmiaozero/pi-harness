// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BackupService } from './backup-service'
import { JsonStore } from '../services/storage'
import type { AppSettings } from '@shared/ipc/api-types'
import { PiConfigService } from '../pi/config-service'

const paths = vi.hoisted(() => ({ root: '', config: '' }))
vi.mock('../services/app-paths', () => ({
  backupDir: () => paths.root,
  getPiConfigDir: () => paths.config
}))
let dir: string
let service: BackupService
const models = vi.fn()
const settings = vi.fn()
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-backup-p0-'))
  paths.root = path.join(dir, 'backups')
  paths.config = path.join(dir, 'config')
  await fs.mkdir(paths.config)
  service = new BackupService(
    new JsonStore(path.join(dir, 'app.json'), { backupRetention: 1 } as AppSettings)
  )
  service.attachConfig({
    withConsistentRead: (read: () => Promise<unknown>) => read(),
    restoreTransaction: async (
      _journal: string,
      _id: string,
      prepare: () => Promise<Map<string, string>>
    ) => {
      for (const [name, text] of await prepare())
        await (name === 'models.json' ? models : settings)(text, {})
    },
    writeModelsRaw: models,
    writeSettingsRaw: settings
  } as unknown as PiConfigService)
})
afterEach(async () => {
  vi.restoreAllMocks()
  models.mockReset()
  settings.mockReset()
  await fs.rm(dir, { recursive: true, force: true })
})
it('loads the restore source before retention prunes it', async () => {
  const backup = await service.create('test', { 'models.json': '{"providers":{}}' })
  await fs.writeFile(path.join(paths.config, 'models.json'), '{"providers":{},"new":true}')
  await service.restore(backup.id)
  expect(models).toHaveBeenCalledWith('{"providers":{}}', expect.any(Object))
  expect(await service.list()).toHaveLength(1)
})
it('refuses to overwrite current data when its undo backup fails', async () => {
  const backup = await service.create('test', { 'models.json': '{"providers":{}}' })
  await fs.writeFile(path.join(paths.config, 'models.json'), '{}')
  vi.spyOn(service, 'create').mockRejectedValueOnce(new Error('disk full'))
  await expect(service.restore(backup.id)).rejects.toThrow('disk full')
  expect(models).not.toHaveBeenCalled()
})
it.each(['missing', 'corrupt'])('validates every source before any write: %s', async (mode) => {
  const backup = await service.create('test', {
    'models.json': '{"providers":{}}',
    'settings.json': '{}'
  })
  const target = path.join(paths.root, backup.id, 'settings.json')
  if (mode === 'missing') await fs.rm(target)
  else await fs.writeFile(target, '{partial')
  await expect(service.restore(backup.id)).rejects.toThrow(/Backup file/)
  expect(models).not.toHaveBeenCalled()
  expect(settings).not.toHaveBeenCalled()
})
it('rejects traversal backup deletion without touching files', async () => {
  await expect(service.delete('../config')).rejects.toThrow('Invalid backup id')
  expect(await fs.stat(paths.config)).toBeTruthy()
})

it('uses one config writer lease and commits both real configuration files', async () => {
  const settingsStore = new JsonStore(path.join(dir, 'real-app.json'), {
    backupRetention: 20
  } as AppSettings)
  const real = new PiConfigService(settingsStore, service)
  service.attachConfig(real)
  const backup = await service.create('test', {
    'models.json': '{"providers":{},"version":2}',
    'settings.json': '{"version":2}'
  })
  await fs.writeFile(path.join(paths.config, 'models.json'), '{"providers":{},"version":1}')
  await fs.writeFile(path.join(paths.config, 'settings.json'), '{"version":1}')
  await service.restore(backup.id)
  expect(
    JSON.parse(await fs.readFile(path.join(paths.config, 'models.json'), 'utf8')).version
  ).toBe(2)
  expect(
    JSON.parse(await fs.readFile(path.join(paths.config, 'settings.json'), 'utf8')).version
  ).toBe(2)
  await real.patchSettings((current) => ({ ...current, futureField: true }))
  expect((await real.readSettingsParsed()).futureField).toBe(true)
})
it('does not write native config if its pre-write backup fails', async () => {
  const real = new PiConfigService(
    new JsonStore(path.join(dir, 'real-app.json'), {} as AppSettings),
    service
  )
  await fs.writeFile(path.join(paths.config, 'settings.json'), '{"valid":true}')
  vi.spyOn(service, 'createBackupForFile').mockRejectedValueOnce(new Error('disk full'))
  await expect(real.writeSettingsRaw('{}')).rejects.toThrow('disk full')
  expect(await fs.readFile(path.join(paths.config, 'settings.json'), 'utf8')).toBe('{"valid":true}')
})

it('rejects a concurrent restore from a second config service without preparing it', async () => {
  const store = new JsonStore(path.join(dir, 'lease-app.json'), {} as AppSettings)
  const first = new PiConfigService(store, service)
  const second = new PiConfigService(store, service)
  let entered!: () => void
  let release!: () => void
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve
  })
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve
  })
  const journalPath = path.join(paths.root, 'concurrent.json')
  const operation = first.restoreTransaction(journalPath, 'first', async () => {
    entered()
    await releasePromise
    return new Map([['settings.json', '{}']])
  })
  await enteredPromise
  const prepare = vi.fn(async () => new Map([['settings.json', '{"other":true}']]))
  try {
    await expect(second.restoreTransaction(journalPath, 'second', prepare)).rejects.toMatchObject({
      code: 'CONFIG_CONFLICT'
    })
    expect(prepare).not.toHaveBeenCalled()
  } finally {
    release()
    await operation
  }
})
it('rejects a damaged backup manifest before writing any configuration', async () => {
  const backup = await service.create('test', { 'models.json': '{"providers":{}}' })
  await fs.writeFile(path.join(paths.root, backup.id, 'manifest.json'), '{partial')
  await expect(service.restore(backup.id)).rejects.toThrow()
  expect(models).not.toHaveBeenCalled()
  expect(settings).not.toHaveBeenCalled()
})

it('serializes local readers and rejects another instance while two files are committing', async () => {
  const store = new JsonStore(path.join(dir, 'read-app.json'), {} as AppSettings)
  const first = new PiConfigService(store, service)
  const second = new PiConfigService(store, service)
  service.attachConfig(first)
  const backup = await service.create('test', {
    'models.json': '{"providers":{},"version":2}',
    'settings.json': '{"version":2}'
  })
  await fs.writeFile(path.join(paths.config, 'models.json'), '{"providers":{},"version":1}')
  await fs.writeFile(path.join(paths.config, 'settings.json'), '{"version":1}')
  let entered!: () => void
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    entered = resolve
  })
  const pause = new Promise<void>((resolve) => {
    release = resolve
  })
  const rename = fs.rename.bind(fs)
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    await rename(from, to)
    if (to === path.join(paths.config, 'models.json')) {
      entered()
      await pause
    }
  })
  const restoring = service.restore(backup.id)
  await ready
  try {
    await expect(second.read()).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' })
    const reading = first.read()
    release()
    await restoring
    const snapshot = await reading
    expect(snapshot.models.version).toBe(2)
    expect(snapshot.settings.version).toBe(2)
  } finally {
    release()
    await restoring
  }
})

it.each(['deleted', 'same-mtime'])(
  'protects a raw editor baseline when externally %s',
  async (mode) => {
    const real = new PiConfigService(
      new JsonStore(path.join(dir, 'conflict-app.json'), {} as AppSettings),
      service
    )
    await fs.writeFile(path.join(paths.config, 'settings.json'), '{"version":1}')
    await real.readRaw('settings')
    const before = await fs.stat(path.join(paths.config, 'settings.json'))
    if (mode === 'deleted') await fs.unlink(path.join(paths.config, 'settings.json'))
    else {
      await fs.writeFile(path.join(paths.config, 'settings.json'), '{"version":9}')
      await fs.utimes(path.join(paths.config, 'settings.json'), before.atime, before.mtime)
    }
    await expect(real.writeSettingsRaw('{"version":2}')).rejects.toMatchObject({
      code: 'CONFIG_CONFLICT'
    })
    if (mode === 'deleted')
      await expect(fs.stat(path.join(paths.config, 'settings.json'))).rejects.toMatchObject({
        code: 'ENOENT'
      })
    else
      expect(await fs.readFile(path.join(paths.config, 'settings.json'), 'utf8')).toBe(
        '{"version":9}'
      )
  }
)

it('preserves a damaged backup without hiding valid records or blocking new backups', async () => {
  const damaged = path.join(paths.root, '1793250000000-ffffffff')
  await fs.mkdir(damaged, { recursive: true })
  await fs.writeFile(path.join(damaged, 'manifest.json'), '{partial')
  const valid = await service.create('manual', { 'settings.json': '{}' })
  expect((await service.list()).map((item) => item.id)).toContain(valid.id)
  expect(await fs.readFile(path.join(damaged, 'manifest.json'), 'utf8')).toBe('{partial')
  await expect(service.restore('1793250000000-ffffffff')).rejects.toBeInstanceOf(SyntaxError)
})

it.each(['models', 'settings'] as const)(
  'protects an external edit during the first %s patch backup',
  async (file) => {
    const real = new PiConfigService(
      new JsonStore(path.join(dir, 'first-patch-app.json'), {} as AppSettings),
      service
    )
    const target = path.join(paths.config, `${file}.json`)
    await fs.writeFile(target, file === 'models' ? '{"providers":{}}' : '{}')
    const external = file === 'models' ? '{"providers":{},"external":true}' : '{"external":true}'
    vi.spyOn(service, 'createBackupForFile').mockImplementationOnce(async () => {
      await fs.writeFile(target, external)
      return null
    })
    const writing =
      file === 'models'
        ? real.patchModels((value) => ({ ...value, patch: true }))
        : real.patchSettings((value) => ({ ...value, patch: true }))
    await expect(writing).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' })
    expect(await fs.readFile(target, 'utf8')).toBe(external)
  }
)
