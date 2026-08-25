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
  const envOverride = process.env.PI_HARNESS_PI_CONFIG_DIR ?? process.env.PI_SWITCH_PI_CONFIG_DIR
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

/** Main-owned directory grants created only by an explicit picker/drop action. */
export function appAuthorizedRootsPath(): string {
  return path.join(userData(), 'authorized-roots.json')
}

/** Pi-Harness encrypted secret vault (non-keychain fallback). */
export function appSecretVaultPath(): string {
  return path.join(userData(), 'secrets.bin')
}

/** Backup directory (kept under userData, never inside Pi config dir). */
export function backupDir(): string {
  return path.join(userData(), 'backups')
}

/** Skill snapshots created before capability update/uninstall. */
export function capabilityBackupDir(): string {
  return path.join(userData(), 'capability-backups')
}

/** Pi-Harness-managed, user-writable Node.js runtime (never requires sudo/admin). */
export function managedNodeRoot(): string {
  const override = process.env.PI_HARNESS_NODE_ROOT?.trim()
  return override ? path.resolve(expandHome(override)) : path.join(homedir(), '.pi-harness', 'node')
}

/** User-level npm prefix used only when the existing global prefix is not writable. */
export function npmUserPrefix(): string {
  const override = process.env.PI_HARNESS_NPM_PREFIX?.trim()
  return override ? path.resolve(expandHome(override)) : path.join(homedir(), '.npm-global')
}

export function environmentDownloadsDir(): string {
  return path.join(userData(), 'environment-downloads')
}

export function environmentBackupDir(): string {
  return path.join(userData(), 'environment-backups')
}

/** Read-only Skills Collections bundled with Pi-Harness. */
export function builtinSkillsRoot(): string {
  const override = process.env.PI_HARNESS_BUILTIN_SKILLS_DIR?.trim()
  if (override) return path.resolve(expandHome(override))
  return app.isPackaged
    ? path.join(process.resourcesPath, 'builtin-skills')
    : path.join(app.getAppPath(), 'resources', 'builtin-skills')
}

/** Log file path. */
export function logFilePath(): string {
  return path.join(userData(), 'logs', 'main.log')
}

export function getIsDev(): boolean {
  return isDev()
}

export { userData }
