import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { AppSettings } from '@shared/ipc/api-types'
import { appSettingsPatchSchema, uiStateSchema } from '@shared/schemas/ipc'
import { atomicWriteJson } from './storage'
import { log } from './logger'

const MAX_SETTINGS_BYTES = 1024 * 1024
const MAX_UI_STATE_BYTES = 2 * 1024 * 1024
const CACHE_DIRECTORIES = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'ShaderCache',
  'GrShaderCache'
]
const LEGACY_RESET_MARKER = 'windows-legacy-reset-2026-09.done'
const LEGACY_STATE_ENTRIES = [
  'settings.json',
  'metadata.json',
  'ui-state.json',
  'authorized-roots.json',
  'workspace-state.json',
  'secrets.bin',
  'harness-policy.json',
  'harness-checkpoints.json',
  'harness-runs.json',
  'harness-traces.json',
  'harness-artifacts.json',
  'harness-evaluations.json',
  'harness-baselines.json',
  'harness-store-settings.json',
  'harness-orchestration.json',
  'backups',
  'capability-backups',
  'environment-downloads',
  'environment-backups',
  'startup-repair',
  'logs',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Service Worker',
  'blob_storage',
  'Network',
  'WebStorage',
  'Preferences',
  'Cookies',
  'Cookies-journal',
  ...CACHE_DIRECTORIES
]

type StartupState = { version: string; running: boolean }

export interface WindowsStartupPreflightResult {
  repaired: string[]
  markClean(): void
}

async function readBoundedJson(filePath: string, maxBytes: number): Promise<unknown> {
  const stat = await fsp.stat(filePath)
  if (stat.size > maxBytes) throw new Error('oversized state file')
  return JSON.parse(await fsp.readFile(filePath, 'utf8')) as unknown
}

async function replaceWithBackup(
  filePath: string,
  value: unknown,
  userData: string
): Promise<void> {
  const backupDir = path.join(userData, 'startup-repair')
  await fsp.mkdir(backupDir, { recursive: true })
  await fsp.copyFile(filePath, path.join(backupDir, `${path.basename(filePath)}.${Date.now()}.bak`))
  await atomicWriteJson(filePath, value)
}

async function repairSettings(userData: string, defaults: AppSettings): Promise<boolean> {
  const filePath = path.join(userData, 'settings.json')
  let source: unknown
  try {
    source = await readBoundedJson(filePath, MAX_SETTINGS_BYTES)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    await replaceWithBackup(filePath, defaults, userData)
    return true
  }

  const current =
    source && typeof source === 'object' && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : {}
  const next = { ...defaults } as Record<string, unknown>
  for (const key of Object.keys(defaults)) {
    if (!(key in current)) continue
    const result = appSettingsPatchSchema.safeParse({ [key]: current[key] })
    if (result.success) next[key] = (result.data as Record<string, unknown>)[key]
  }
  if (JSON.stringify(current) === JSON.stringify(next)) return false
  await replaceWithBackup(filePath, next, userData)
  return true
}

async function repairUiState(userData: string): Promise<boolean> {
  const filePath = path.join(userData, 'ui-state.json')
  try {
    const value = await readBoundedJson(filePath, MAX_UI_STATE_BYTES)
    if (uiStateSchema.safeParse(value).success) return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
  }
  await replaceWithBackup(filePath, {}, userData)
  return true
}

export async function runWindowsStartupPreflight(
  userData: string,
  version: string,
  defaults: AppSettings,
  options: { resetLegacyData?: boolean } = {}
): Promise<WindowsStartupPreflightResult> {
  const repaired: string[] = []
  const statePath = path.join(userData, 'startup-state.json')
  const resetMarker = path.join(userData, LEGACY_RESET_MARKER)
  if (options.resetLegacyData) {
    const alreadyReset = await fsp.access(resetMarker).then(
      () => true,
      () => false
    )
    if (!alreadyReset) {
      const legacyEntries = await Promise.all(
        LEGACY_STATE_ENTRIES.map(async (name) =>
          fsp.access(path.join(userData, name)).then(
            () => name,
            () => null
          )
        )
      )
      if (legacyEntries.some(Boolean)) {
        for (const name of LEGACY_STATE_ENTRIES) {
          await fsp.rm(path.join(userData, name), { recursive: true, force: true })
        }
        repaired.push('legacy-app-data')
      }
      await fsp.mkdir(userData, { recursive: true })
      await fsp.writeFile(resetMarker, version, { flag: 'wx' })
    }
  }
  let previous: StartupState | null = null
  try {
    const value = await readBoundedJson(statePath, 4096)
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as StartupState).version === 'string' &&
      typeof (value as StartupState).running === 'boolean'
    )
      previous = value as StartupState
  } catch {
    // A missing or damaged marker is treated as an upgrade from an older build.
  }

  if (!previous || previous.running || previous.version !== version) {
    for (const name of CACHE_DIRECTORIES) {
      await fsp
        .rm(path.join(userData, name), { recursive: true, force: true })
        .catch((error) =>
          log.app.warn('startup cache cleanup failed', { name, error: String(error) })
        )
    }
    repaired.push('browser-cache')
  }
  if (await repairSettings(userData, defaults)) repaired.push('settings')
  if (await repairUiState(userData)) repaired.push('ui-state')

  await atomicWriteJson(statePath, { version, running: true } satisfies StartupState)
  return {
    repaired,
    markClean(): void {
      try {
        fs.writeFileSync(
          statePath,
          JSON.stringify({ version, running: false } satisfies StartupState)
        )
      } catch (error) {
        log.app.warn('startup marker cleanup failed', error)
      }
    }
  }
}
