/**
 * BackupService — snapshots of Pi native config before dangerous writes.
 * Backups live under Electron userData/backups, never inside ~/.pi.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { backupDir, getPiConfigDir } from '../services/app-paths'
import { atomicWriteJson, atomicWriteText, readTextFile, readJsonFile } from '../services/storage'
import { BackupError, NotFoundError } from '../services/errors'
import { log } from '../services/logger'
import { PI_FILES, APP_VERSION } from '@shared/constants/index'
import type { BackupRecord, AppSettings } from '@shared/ipc/api-types'
import type { JsonStore } from '../services/storage'
import type { PiConfigService } from '../pi/config-service'

interface BackupManifest {
  id: string
  timestamp: number
  reason: string
  source: string
  files: string[]
  sizeBytes: number
  appVersion: string
  configVersion: string | null
}

export class BackupService {
  constructor(private readonly settingsStore: JsonStore<AppSettings>) {}

  /**
   * Late-bound during bootstrap: BackupService is constructed before
   * PiConfigService (which itself takes BackupService), so the config handle
   * is attached once both exist. Only `restore()` needs it.
   */
  private _config: PiConfigService | null = null
  attachConfig(config: PiConfigService): void {
    this._config = config
  }
  private cfg(): PiConfigService {
    if (!this._config) throw new BackupError('config service not attached')
    return this._config
  }

  private root(): string {
    return backupDir()
  }

  private piDir(): string {
    return getPiConfigDir(this.settingsStore.peek().manualConfigDir)
  }

  private backupPath(id: string): string {
    return path.join(this.root(), id)
  }

  async list(): Promise<BackupRecord[]> {
    const root = this.root()
    await fs.mkdir(root, { recursive: true })
    const entries = await fs.readdir(root, { withFileTypes: true })
    const records: BackupRecord[] = []
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const manifest = await readJsonFile<BackupManifest>(
        path.join(root, ent.name, 'manifest.json')
      )
      if (manifest) records.push(manifest)
    }
    return records.sort((a, b) => b.timestamp - a.timestamp)
  }

  async createBackupForFile(
    file: 'models' | 'settings',
    reason: string
  ): Promise<BackupRecord | null> {
    const srcName = PI_FILES[file]
    const src = path.join(this.piDir(), srcName)
    const text = await readTextFile(src)
    if (text === null) return null
    return this.create(reason, { [srcName]: text })
  }

  async create(reason = 'manual', fileContents?: Record<string, string>): Promise<BackupRecord> {
    const id = `${Date.now()}-${randomBytes(4).toString('hex')}`
    const dest = this.backupPath(id)
    await fs.mkdir(dest, { recursive: true })

    const files: string[] = []
    let sizeBytes = 0
    const names = fileContents ? Object.keys(fileContents) : [PI_FILES.models, PI_FILES.settings]

    for (const name of names) {
      const content =
        fileContents?.[name] ?? (await readTextFile(path.join(this.piDir(), name))) ?? null
      if (content === null) continue
      await atomicWriteText(path.join(dest, name), content)
      files.push(name)
      sizeBytes += Buffer.byteLength(content, 'utf8')
    }

    if (files.length === 0) {
      await fs.rm(dest, { recursive: true, force: true })
      throw new BackupError('Nothing to backup — Pi config files are missing')
    }

    const manifest: BackupManifest = {
      id,
      timestamp: Date.now(),
      reason,
      source: this.piDir(),
      files,
      sizeBytes,
      appVersion: APP_VERSION,
      configVersion: null
    }
    await atomicWriteJson(path.join(dest, 'manifest.json'), manifest)
    log.backup.info('backup created', { id, reason, files })
    await this.prune()
    return manifest
  }

  async restore(id: string): Promise<void> {
    const dest = this.backupPath(id)
    const manifest = await readJsonFile<BackupManifest>(path.join(dest, 'manifest.json'))
    if (!manifest) throw new NotFoundError(`Backup not found: ${id}`)

    // Safety: snapshot current config before restore (undo point).
    await this.create('pre-restore').catch((err) => {
      log.backup.warn('pre-restore backup failed:', err)
    })

    // Route through PiConfigService so the write is validated, backed-up-safe,
    // and — critically — refreshes PiConfigService's mtime/raw baseline. This
    // closes the stale-baseline window where a restore could silently clobber
    // an in-flight editor. `overwrite: true` because restore is an explicit
    // replace; `skipBackup: true` because we already snapshotted above.
    for (const name of manifest.files) {
      const text = await readTextFile(path.join(dest, name))
      if (text === null) continue
      if (name === PI_FILES.models) {
        await this.cfg().writeModelsRaw(text, {
          overwrite: true,
          skipBackup: true,
          reason: `restore ${id}`
        })
      } else if (name === PI_FILES.settings) {
        await this.cfg().writeSettingsRaw(text, {
          overwrite: true,
          skipBackup: true,
          reason: `restore ${id}`
        })
      } else {
        // Unknown file in manifest (back-compat) — write directly under the Pi dir.
        await fs.mkdir(this.piDir(), { recursive: true })
        await atomicWriteText(path.join(this.piDir(), name), text)
      }
    }
    log.backup.info('backup restored', { id })
  }

  async delete(id: string): Promise<void> {
    const dest = this.backupPath(id)
    try {
      await fs.rm(dest, { recursive: true, force: true })
    } catch (err) {
      throw new BackupError(`Failed to delete backup ${id}`, { cause: String(err) })
    }
  }

  async openFolder(): Promise<string> {
    const root = this.root()
    await fs.mkdir(root, { recursive: true })
    return root
  }

  private async prune(): Promise<void> {
    const settings = this.settingsStore.peek()
    const retention = settings.backupRetention ?? 20
    if (retention <= 0) return
    const all = await this.list()
    const excess = all.slice(retention)
    for (const b of excess) {
      await this.delete(b.id).catch(() => {})
    }
  }
}
