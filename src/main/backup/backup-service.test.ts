// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BackupService } from './backup-service'
import { JsonStore } from '../services/storage'
import type { AppSettings } from '@shared/ipc/api-types'
import type { PiConfigService } from '../pi/config-service'

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
