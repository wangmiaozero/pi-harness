// @ts-nocheck
/**
 * Runtime-side path resolution. Mirrors Electron `src/main/services/app-paths.ts`
 * so both hosts read and write the same files under `PI_HARNESS_USER_DATA`.
 */

import path from 'node:path'
import { homedir } from 'node:os'
import { runtimeUserDataDir } from '../../harness-control/paths.js'
import { app } from '../../compat/electron.js'

const isDev = () => process.env.PI_HARNESS_PACKAGED !== '1' && !process.env.NODE_ENV?.includes('production')

/** Kept for Electron-source call sites; the sidecar has nothing to inject. */
export function initAppPaths(_appInstance?: unknown): void {}

function userData(): string {
  return runtimeUserDataDir()
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

export function appSettingsPath(): string {
  return path.join(userData(), 'settings.json')
}

export function harnessPolicyPath(): string {
  return path.join(userData(), 'harness-policy.json')
}

export function harnessCheckpointsPath(): string {
  return path.join(userData(), 'harness-checkpoints.json')
}

export function harnessRunsPath(): string {
  return path.join(userData(), 'harness-runs.json')
}

export function harnessTracesPath(): string {
  return path.join(userData(), 'harness-traces.json')
}

export function harnessArtifactsPath(): string {
  return path.join(userData(), 'harness-artifacts.json')
}

export function harnessEvaluationsPath(): string {
  return path.join(userData(), 'harness-evaluations.json')
}

export function harnessBaselinesPath(): string {
  return path.join(userData(), 'harness-baselines.json')
}

export function harnessStoreSettingsPath(): string {
  return path.join(userData(), 'harness-store-settings.json')
}

export function harnessOrchestrationPath(): string {
  return path.join(userData(), 'harness-orchestration.json')
}

export function appMetadataPath(): string {
  return path.join(userData(), 'metadata.json')
}

export function appUiStatePath(): string {
  return path.join(userData(), 'ui-state.json')
}

export function appAuthorizedRootsPath(): string {
  return path.join(userData(), 'authorized-roots.json')
}

export function appWorkspaceStatePath(): string {
  return path.join(userData(), 'workspace-state.json')
}

export function appSecretVaultPath(): string {
  return path.join(userData(), 'secrets.bin')
}

export function backupDir(): string {
  return path.join(userData(), 'backups')
}

export function capabilityBackupDir(): string {
  return path.join(userData(), 'capability-backups')
}

export function managedNodeRoot(): string {
  const override = process.env.PI_HARNESS_NODE_ROOT?.trim()
  return override ? path.resolve(expandHome(override)) : path.join(homedir(), '.pi-harness', 'node')
}

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

export function builtinSkillsRoot(): string {
  const override = process.env.PI_HARNESS_BUILTIN_SKILLS_DIR?.trim()
  if (override) return path.resolve(expandHome(override))
  const resources = process.env.PI_HARNESS_RESOURCES_DIR?.trim()
  if (resources) return path.join(path.resolve(resources), 'builtin-skills')
  return path.join(app.getAppPath(), 'resources', 'builtin-skills')
}

export function logFilePath(): string {
  return path.join(userData(), 'logs', 'main.log')
}

export function getIsDev(): boolean {
  return isDev()
}

export { userData }
