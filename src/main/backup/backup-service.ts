/**
 * BackupService — snapshots of Pi native config before dangerous writes.
 * Backups live under Electron userData/backups, never inside ~/.pi.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { contentHash, journalSchema } from './restore-transaction'
import { randomBytes } from 'node:crypto'
import { backupDir, getPiConfigDir } from '../services/app-paths'
import { atomicWriteJson, atomicWriteText, readTextFile, readJsonFile } from '../services/storage'
import { BackupError, NotFoundError } from '../services/errors'
import { log } from '../services/logger'
import { PI_FILES, APP_VERSION } from '@shared/constants/index'
import type { BackupRecord, AppSettings } from '@shared/ipc/api-types'
import type { JsonStore } from '../services/storage'
import type { PiConfigService } from '../pi/config-service'
import { piModelsConfigSchema, piSettingsConfigSchema } from '@shared/schemas/pi'
import { backupIdSchema } from '@shared/schemas/domain'

interface BackupManifest {
  id: string
  timestamp: number
  reason: string
  source: string
  files: string[]
  sizeBytes: number
  appVersion: string
  configVersion: string | null
  checksums?: Record<string, string>
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
    if (!backupIdSchema.safeParse(id).success) {
      throw new BackupError('Invalid backup id')
    }
    return path.join(this.root(), id)
  }

  async list(): Promise<BackupRecord[]> {
    const root = this.root()
    await fs.mkdir(root, { recursive: true })
    const entries = await fs.readdir(root, { withFileTypes: true })
    const records: BackupRecord[] = []
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      try {
        const manifest = await readJsonFile<BackupManifest>(
          path.join(root, ent.name, 'manifest.json')
        )
        if (manifest) records.push(manifest)
      } catch {
        // A damaged, unrelated backup must not hide the recovery journal or
        // prevent every subsequent pre-write backup. Preserve it for inspection.
        log.backup.warn('Backup metadata could not be read; files were preserved', { id: ent.name })
      }
    }
    const pending = await this.pendingRestore()
    if (pending) {
      const record = records.find((item) => item.id === pending.id)
      if (record) record.recoveryPending = true
      else
        records.push({
          id: pending.id,
          timestamp: 0,
          reason: 'pre-restore',
          source: pending.directory,
          files: pending.files.map((file) => file.name),
          sizeBytes: 0,
          appVersion: APP_VERSION,
          configVersion: null,
          recoveryPending: true
        })
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
    if (!fileContents && this._config)
      return this._config.withConsistentRead(() => this.createSnapshot(reason))
    return this.createSnapshot(reason, fileContents)
  }

  private async createSnapshot(
    reason: string,
    fileContents?: Record<string, string>
  ): Promise<BackupRecord> {
    const id = `${Date.now()}-${randomBytes(4).toString('hex')}`
    const dest = this.backupPath(id)
    await fs.mkdir(dest, { recursive: true })

    const files: string[] = []
    const checksums: Record<string, string> = {}
    let sizeBytes = 0
    const names = fileContents ? Object.keys(fileContents) : [PI_FILES.models, PI_FILES.settings]

    for (const name of names) {
      const content =
        fileContents?.[name] ?? (await readTextFile(path.join(this.piDir(), name))) ?? null
      if (content === null) continue
      await atomicWriteText(path.join(dest, name), content)
      files.push(name)
      checksums[name] = contentHash(content)
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
      configVersion: null,
      checksums
    }
    await atomicWriteJson(path.join(dest, 'manifest.json'), manifest)
    log.backup.info('backup created', { id, reason, files })
    await this.prune()
    return manifest
  }

  async restore(id: string): Promise<void> {
    const journalPath = path.join(this.root(), `restore-${contentHash(this.piDir())}.json`)
    await this.cfg().restoreTransaction(journalPath, id, async () => {
      const dest = this.backupPath(id)
      const manifest = await readJsonFile<BackupManifest>(path.join(dest, 'manifest.json'))
      if (!manifest) throw new NotFoundError(`Backup not found: ${id}`)

      // Materialize and validate the entire source before taking an undo point.
      // Creating that point can prune the selected backup (retention may be one).
      if (!Array.isArray(manifest.files)) throw new BackupError('Invalid backup manifest')
      const contents = new Map<string, string>()
      for (const name of manifest.files) {
        if (name !== PI_FILES.models && name !== PI_FILES.settings) continue
        const text = await readTextFile(path.join(dest, name))
        if (text === null) throw new BackupError('Backup file is missing')
        if (manifest.checksums?.[name] && manifest.checksums[name] !== contentHash(text))
          throw new BackupError('Backup file checksum mismatch')
        try {
          const schema = name === PI_FILES.models ? piModelsConfigSchema : piSettingsConfigSchema
          schema.parse(JSON.parse(text))
        } catch {
          throw new BackupError('Backup file is invalid')
        }
        contents.set(name, text)
      }
      if (!contents.size) throw new BackupError('Backup contains no supported configuration')

      const current: Record<string, string> = {}
      for (const name of [PI_FILES.models, PI_FILES.settings]) {
        const text = await readTextFile(path.join(this.piDir(), name))
        if (text !== null) current[name] = text
      }
      // Never replace the only current copy when its undo point cannot be saved.
      if (Object.keys(current).length) await this.create('pre-restore', current)

      return contents
    })
    log.backup.info('backup restored', { id })
  }

  async assertNoUnfinishedRestore(): Promise<void> {
    const pending = await this.pendingRestore()
    if (pending)
      throw new BackupError(
        `A restore is unfinished. Open Backups and restore ${pending.id} again before changing configuration`
      )
  }

  private async pendingRestore() {
    const journalPath = path.join(this.root(), `restore-${contentHash(this.piDir())}.json`)
    const text = await readTextFile(journalPath)
    if (text === null) return null
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new BackupError('Restore record is damaged; preserve the backup folder for recovery')
    }
    const result = journalSchema.safeParse(data)
    if (!result.success)
      throw new BackupError('Restore record is damaged; preserve the backup folder for recovery')
    return ['completed', 'rolled-back'].includes(result.data.status) ? null : result.data
  }

  async delete(id: string): Promise<void> {
    if ((await this.pendingRestore())?.id === id)
      throw new BackupError('This backup is needed to finish an interrupted restore')
    const dest = this.backupPath(id)
    try {
      await fs.rm(dest, { recursive: true, force: true })
    } catch (err) {
      throw new BackupError(`Failed to delete backup ${id}`, { cause: String(err) })
    }
  }

  /** Keep the newest `retention` backups and delete every older snapshot. */
  async pruneToRetention(retention: number): Promise<{ deleted: number; freedBytes: number }> {
    if (!Number.isSafeInteger(retention) || retention < 1) {
      throw new BackupError('Backup retention must be a positive integer')
    }
    const all = await this.list()
    const excess = all.slice(retention)
    let freedBytes = 0
    let deleted = 0
    for (const backup of excess) {
      try {
        await this.delete(backup.id)
        deleted++
        freedBytes += backup.sizeBytes ?? 0
      } catch (err) {
        log.backup.warn('prune backup failed:', backup.id, err)
      }
    }
    log.backup.info('pruned backups to retention', { retention, deleted, freedBytes })
    return { deleted, freedBytes }
  }

  async openFolder(): Promise<string> {
    const root = this.root()
    await fs.mkdir(root, { recursive: true })
    return root
  }

  private async prune(): Promise<void> {
    const settings = this.settingsStore.peek()
    const retention = settings.backupRetention ?? 20
    if (!Number.isSafeInteger(retention) || retention <= 0) return
    await this.pruneToRetention(retention)
  }
}
