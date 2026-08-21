/**
 * PiConfigService — safe access to Pi's native configuration files.
 *
 * Write pipeline (every mutation):
 *   Read → Validate → Backup → Patch → Serialize → Atomic write
 *           → Read again → Validate → Refresh UI
 *
 * Guarantees:
 *   - Unknown fields preserved (loose Zod parsing + targeted patching).
 *   - Atomic writes (temp → fsync → rename); a crash never corrupts config.
 *   - External-conflict detection: mtime is checked before writing; if the
 *     file changed since the last read, a ConfigConflictError is thrown so the
 *     UI can offer Reload/Compare/Overwrite/Cancel.
 *   - Automatic backup before any dangerous write.
 *   - Debounced fs.watch via chokidar; pushes config-changed events.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import chokidar, { type FSWatcher } from 'chokidar'
import { PI_FILES } from '@shared/constants/index'
import { getPiConfigDir } from '../services/app-paths'
import { readTextFile, atomicWriteText, fileMtime, type JsonStore } from '../services/storage'
import { piModelsConfigSchema, piSettingsConfigSchema } from '@shared/schemas/pi'
import { ConfigConflictError, ConfigError, ConfigParseError } from '../services/errors'
import { log } from '../services/logger'
import type { BackupService } from '../backup/backup-service'
import type { AppSettings } from '@shared/ipc/api-types'
import type { PiModelsConfig, PiSettingsConfig, PiProviderConfig } from '@shared/types/pi'

const WATCH_DEBOUNCE_MS = 400

export interface ConfigSnapshot {
  models: PiModelsConfig
  settings: PiSettingsConfig
  modelsMtime: number | null
  settingsMtime: number | null
}

export interface ConflictSnapshot {
  file: 'models' | 'settings'
  path: string
  /** Last raw content Pi-Harness successfully read or wrote (the "editor baseline"). */
  lastLoaded: string
  /** Current raw content freshly read from disk. */
  currentDisk: string
  lastMtime: number | null
  currentMtime: number | null
}

export interface WriteOptions {
  /** Force overwrite even if the file changed externally since last read. */
  overwrite?: boolean
  /** Reason recorded in the automatic backup. */
  reason?: string
  /** Skip the automatic pre-write backup (caller has already snapshotted). */
  skipBackup?: boolean
}

export class PiConfigService {
  private modelsMtime: number | null = null
  private settingsMtime: number | null = null
  private modelsRaw: string | null = null
  private settingsRaw: string | null = null
  private watcher: FSWatcher | null = null
  private watchTimer: NodeJS.Timeout | null = null
  private onExternalChange: (() => void) | null = null

  constructor(
    private readonly settingsStore: JsonStore<AppSettings>,
    private readonly backup: BackupService
  ) {}

  private dir(): string {
    return getPiConfigDir(this.settingsStore.peek().manualConfigDir)
  }

  modelsPath(): string {
    return path.join(this.dir(), PI_FILES.models)
  }

  settingsPath(): string {
    return path.join(this.dir(), PI_FILES.settings)
  }

  /** Read both config files (parsed loosely) with current mtimes. */
  async read(): Promise<ConfigSnapshot> {
    const dir = this.dir()
    const modelsPath = path.join(dir, PI_FILES.models)
    const settingsPath = path.join(dir, PI_FILES.settings)
    const modelsText = await readTextFile(modelsPath)
    const settingsText = await readTextFile(settingsPath)
    // Cache the raw baseline so a later conflict snapshot can diff
    // "what Pi-Harness last saw" vs "what's on disk now".
    this.modelsRaw = modelsText
    this.settingsRaw = settingsText
    const models = this.parseModelsText(modelsText, modelsPath)
    const settings = this.parseSettingsText(settingsText, settingsPath)
    this.modelsMtime = await fileMtime(modelsPath)
    this.settingsMtime = await fileMtime(settingsPath)
    return {
      models,
      settings,
      modelsMtime: this.modelsMtime,
      settingsMtime: this.settingsMtime
    }
  }

  async readModelsParsed(): Promise<PiModelsConfig> {
    const p = this.modelsPath()
    const text = await readTextFile(p)
    return this.parseModelsText(text, p)
  }

  async readSettingsParsed(): Promise<PiSettingsConfig> {
    const p = this.settingsPath()
    const text = await readTextFile(p)
    return this.parseSettingsText(text, p)
  }

  private parseModelsText(text: string | null, p: string): PiModelsConfig {
    if (!text) return { providers: {} }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (err) {
      throw new ConfigParseError(`models.json is not valid JSON: ${(err as Error).message}`, {
        path: p
      })
    }
    const result = piModelsConfigSchema.safeParse(json)
    if (!result.success) {
      throw new ConfigParseError(`models.json failed schema validation`, {
        path: p,
        issues: result.error.issues
      })
    }
    return result.data as PiModelsConfig
  }

  private parseSettingsText(text: string | null, p: string): PiSettingsConfig {
    if (!text) return {}
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (err) {
      throw new ConfigParseError(`settings.json is not valid JSON: ${(err as Error).message}`, {
        path: p
      })
    }
    const result = piSettingsConfigSchema.safeParse(json)
    if (!result.success) {
      throw new ConfigParseError(`settings.json failed schema validation`, {
        path: p,
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
          code: i.code
        }))
      })
    }
    return result.data as PiSettingsConfig
  }

  async readRaw(
    file: 'models' | 'settings'
  ): Promise<{ path: string; content: string; mtime: number | null }> {
    const p = file === 'models' ? this.modelsPath() : this.settingsPath()
    const content = (await readTextFile(p)) ?? ''
    // The raw editor load establishes a new working baseline.
    if (file === 'models') this.modelsRaw = content
    else this.settingsRaw = content
    const mtime = await fileMtime(p)
    if (file === 'models') this.modelsMtime = mtime
    else this.settingsMtime = mtime
    return { path: p, content, mtime }
  }

  /**
   * Snapshot for the Configuration Conflict dialog:
   *   lastLoaded = the raw content Pi-Harness last established as its baseline
   *                (from read()/readRaw()/a successful write)
   *   currentDisk = a fresh read of the file right now
   * Falls back to currentDisk when no baseline is cached (e.g. fresh start).
   */
  async getConflictSnapshot(file: 'models' | 'settings'): Promise<ConflictSnapshot> {
    const p = file === 'models' ? this.modelsPath() : this.settingsPath()
    const currentDisk = (await readTextFile(p)) ?? ''
    const lastLoaded = (file === 'models' ? this.modelsRaw : this.settingsRaw) ?? currentDisk
    const currentMtime = await fileMtime(p)
    const lastMtime = file === 'models' ? this.modelsMtime : this.settingsMtime
    return { file, path: p, lastLoaded, currentDisk, lastMtime, currentMtime }
  }

  /** Patch a single provider, preserving all other providers and unknown keys. */
  async patchProvider(
    key: string,
    mutate: (existing: PiProviderConfig | undefined) => PiProviderConfig | undefined,
    options: WriteOptions = {}
  ): Promise<void> {
    await this.patchModels((models) => {
      const current = models.providers[key]
      const next = mutate(current)
      const nextProviders = { ...models.providers }
      if (next === undefined) {
        delete nextProviders[key]
      } else {
        nextProviders[key] = next
      }
      return { ...models, providers: nextProviders }
    }, options)
  }

  /**
   * Atomic models.json mutation (single read/write). Use when a change spans
   * multiple providers — e.g. moving a model between providers.
   */
  async patchModels(
    mutate: (models: PiModelsConfig) => PiModelsConfig,
    options: WriteOptions = {}
  ): Promise<void> {
    await this.withWriteLock(async () => {
      const models = await this.readModelsParsed()
      const next = mutate(models)
      await this.writeModels(next, options)
    })
  }

  /** Replace models.json entirely (used by raw editor). */
  async writeModelsRaw(content: string, options: WriteOptions = {}): Promise<void> {
    await this.withWriteLock(async () => {
      let json: unknown
      try {
        json = JSON.parse(content)
      } catch (err) {
        throw new ConfigParseError(`Invalid JSON: ${(err as Error).message}`)
      }
      const result = piModelsConfigSchema.safeParse(json)
      if (!result.success) {
        throw new ConfigError('models.json failed validation', { issues: result.error.issues })
      }
      await this.backupBeforeWrite('models', options.reason ?? 'raw edit', options.skipBackup)
      await this.assertNoConflict('models', options.overwrite)
      await atomicWriteText(this.modelsPath(), content)
      this.modelsRaw = content
      this.modelsMtime = await fileMtime(this.modelsPath())
      log.config.info('models.json written (raw)')
    })
  }

  /** Replace settings.json entirely (used by raw editor). */
  async writeSettingsRaw(content: string, options: WriteOptions = {}): Promise<void> {
    await this.withWriteLock(async () => {
      let json: unknown
      try {
        json = JSON.parse(content)
      } catch (err) {
        throw new ConfigParseError(`Invalid JSON: ${(err as Error).message}`)
      }
      const result = piSettingsConfigSchema.safeParse(json)
      if (!result.success) {
        throw new ConfigError('settings.json failed validation', { issues: result.error.issues })
      }
      await this.backupBeforeWrite('settings', options.reason ?? 'raw edit', options.skipBackup)
      await this.assertNoConflict('settings', options.overwrite)
      await atomicWriteText(this.settingsPath(), content)
      this.settingsRaw = content
      this.settingsMtime = await fileMtime(this.settingsPath())
      log.config.info('settings.json written (raw)')
    })
  }

  /** Patch settings (e.g. set active model), preserving unknown keys. */
  async patchSettings(
    mutate: (settings: PiSettingsConfig) => PiSettingsConfig,
    options: WriteOptions = {}
  ): Promise<void> {
    await this.withWriteLock(async () => {
      const settings = await this.readSettingsParsed()
      const next = mutate(settings)
      await this.backupBeforeWrite(
        'settings',
        options.reason ?? 'settings patch',
        options.skipBackup
      )
      await this.assertNoConflict('settings', options.overwrite)
      const text = JSON.stringify(next, null, 2) + '\n'
      await atomicWriteText(this.settingsPath(), text)
      this.settingsRaw = text
      this.settingsMtime = await fileMtime(this.settingsPath())
    })
  }

  async getActiveModel(): Promise<{ providerKey: string | null; modelId: string | null }> {
    const s = await this.readSettingsParsed()
    return {
      providerKey: s.defaultProvider ?? null,
      modelId: s.defaultModel ?? null
    }
  }

  async setActiveModel(
    providerKey: string,
    modelId: string,
    options: WriteOptions = {}
  ): Promise<void> {
    await this.patchSettings(
      (s) => ({ ...s, defaultProvider: providerKey, defaultModel: modelId }),
      { ...options, reason: options.reason ?? `set active model ${providerKey}/${modelId}` }
    )
  }

  private async writeModels(models: PiModelsConfig, options: WriteOptions): Promise<void> {
    await this.backupBeforeWrite('models', options.reason ?? 'models patch', options.skipBackup)
    await this.assertNoConflict('models', options.overwrite)
    const text = JSON.stringify(models, null, 2) + '\n'
    await atomicWriteText(this.modelsPath(), text)
    this.modelsRaw = text
    this.modelsMtime = await fileMtime(this.modelsPath())
    log.config.debug('models.json written', { reason: options.reason })
  }

  private async backupBeforeWrite(
    file: 'models' | 'settings',
    reason: string,
    skip?: boolean
  ): Promise<void> {
    if (skip) return
    try {
      await this.backup.createBackupForFile(file, reason)
    } catch (err) {
      log.backup.warn('pre-write backup failed (continuing):', err)
    }
  }

  private async assertNoConflict(file: 'models' | 'settings', overwrite?: boolean): Promise<void> {
    if (overwrite) return
    const p = file === 'models' ? this.modelsPath() : this.settingsPath()
    const current = await fileMtime(p)
    const last = file === 'models' ? this.modelsMtime : this.settingsMtime
    if (last !== null && current !== null && current !== last) {
      throw new ConfigConflictError(
        `${PI_FILES[file]} was modified externally since it was last read`,
        { file, lastMtime: last, currentMtime: current }
      )
    }
  }

  private writing = false
  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    while (this.writing) {
      await new Promise((r) => setTimeout(r, 10))
    }
    this.writing = true
    try {
      return await fn()
    } finally {
      this.writing = false
    }
  }

  startWatcher(onExternalChange: () => void): void {
    if (this.watcher) return
    this.onExternalChange = onExternalChange
    const dir = this.dir()
    this.watcher = chokidar.watch([this.modelsPath(), this.settingsPath()], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 80 },
      persistent: true
    })
    this.watcher.on('all', () => {
      if (this.watchTimer) clearTimeout(this.watchTimer)
      this.watchTimer = setTimeout(() => {
        log.config.debug('external config change detected')
        this.modelsMtime = null // invalidate so our next write doesn't false-conflict
        this.settingsMtime = null
        this.onExternalChange?.()
      }, WATCH_DEBOUNCE_MS)
    })
    log.config.info(`watching ${dir}`)
    // Ensure dir exists for the watcher to attach.
    void fs.mkdir(dir, { recursive: true }).catch(() => {})
  }

  stopWatcher(): void {
    this.watcher?.close().catch(() => {})
    this.watcher = null
    if (this.watchTimer) clearTimeout(this.watchTimer)
  }

  async getStatus(): Promise<{
    modelsPath: string
    settingsPath: string
    modelsExists: boolean
    settingsExists: boolean
    modelsValid: boolean
    settingsValid: boolean
    lastError: string | null
    lastReadAt: number | null
    lastMtime: number | null
  }> {
    const modelsPath = this.modelsPath()
    const settingsPath = this.settingsPath()
    let modelsExists = false
    let settingsExists = false
    let modelsValid = true
    let settingsValid = true
    let lastError: string | null = null
    try {
      const modelsText = await readTextFile(modelsPath)
      modelsExists = modelsText !== null
      if (modelsText) {
        const r = piModelsConfigSchema.safeParse(JSON.parse(modelsText))
        modelsValid = r.success
        if (!r.success) lastError = `models.json: ${r.error.issues[0]?.message ?? 'invalid'}`
      }
      const settingsText = await readTextFile(settingsPath)
      settingsExists = settingsText !== null
      if (settingsText) {
        const r = piSettingsConfigSchema.safeParse(JSON.parse(settingsText))
        settingsValid = r.success
        if (!r.success)
          lastError =
            (lastError ? lastError + '; ' : '') +
            `settings.json: ${r.error.issues[0]?.message ?? 'invalid'}`
      }
    } catch (err) {
      lastError = (err as Error).message
    }
    return {
      modelsPath,
      settingsPath,
      modelsExists,
      settingsExists,
      modelsValid,
      settingsValid,
      lastError,
      lastReadAt: Date.now(),
      lastMtime: this.modelsMtime
    }
  }
}
