/**
 * Centralised, validated path resolution. No string concatenation of paths —
 * everything goes through node:path and Electron's app.getPath().
 */

import path from 'node:path'
import { homedir } from 'node:os'

const isDev = () => !app.isPackaged && !process.env.NODE_ENV?.includes('production')

let app: import('electron').App

export function initAppPaths(appInstance: import('electron').App): void {
  app = appInstance
}

function userData(): string {
  return app.getPath('userData')
}

/** Pi config directory. Defaults to ~/.pi/agent, overridable by settings/env. */
export function getPiConfigDir(override?: string | null): string {
  const envOverride =
    process.env.PI_HARNESS_PI_CONFIG_DIR ?? process.env.PI_SWITCH_PI_CONFIG_DIR
  if (override && override.trim()) return path.resolve(expandHome(override.trim()))
  if (envOverride && envOverride.trim()) return path.resolve(expandHome(envOverride.trim()))
  return path.join(homedir(), '.pi', 'agent')
}

/** Default Pi skill directories (global). */
export function getDefaultSkillDirs(): string[] {
  const home = homedir()
  return [path.join(home, '.pi', 'agent', 'skills'), path.join(home, '.agents', 'skills')]
}

/** Expand a leading ~ in a path string. */
export function expandHome(p: string): string {
  if (p.startsWith('~')) return path.join(homedir(), p.slice(1))
  return p
}

/** Pi-Harness app settings file (Electron userData). */
export function appSettingsPath(): string {
  return path.join(userData(), 'settings.json')
}

/** Pi-Harness metadata file (Electron userData). */
export function appMetadataPath(): string {
  return path.join(userData(), 'metadata.json')
}

/** Pi-Harness UI state file (Electron userData). */
export function appUiStatePath(): string {
  return path.join(userData(), 'ui-state.json')
}

/** Pi-Harness encrypted secret vault (non-keychain fallback). */
export function appSecretVaultPath(): string {
  return path.join(userData(), 'secrets.bin')
}

/** Backup directory (kept under userData, never inside Pi config dir). */
export function backupDir(): string {
  return path.join(userData(), 'backups')
}

/** Log file path. */
export function logFilePath(): string {
  return path.join(userData(), 'logs', 'main.log')
}

export function getIsDev(): boolean {
  return isDev()
}

export { userData }
