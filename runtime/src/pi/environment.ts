/**
 * Resolves the Pi agent config directory policy for the runtime.
 *
 * The SDK natively honours `PI_CODING_AGENT_DIR`. The app historically uses
 * `PI_HARNESS_PI_CONFIG_DIR` (and the legacy `PI_SWITCH_PI_CONFIG_DIR`), so
 * the runtime bridges those onto the SDK's variable before loading it — one
 * place, so every SDK subsystem (SessionManager.listAll, SettingsManager,
 * model registry) agrees on the directory.
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'

export const AGENT_DIR_ENV_VARS = ['PI_HARNESS_PI_CONFIG_DIR', 'PI_SWITCH_PI_CONFIG_DIR'] as const

/** SDK-native override, applied last so app vars win. */
const SDK_AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR'

export function expandHome(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2))
  return value
}

/**
 * Resolve the app-level agent dir override, if any. Returns `undefined` when
 * no override is configured (SDK default `~/.pi/agent` applies).
 */
export function resolveAgentDirOverride(): string | undefined {
  for (const key of AGENT_DIR_ENV_VARS) {
    const value = process.env[key]
    if (value && value.trim()) return expandHome(value.trim())
  }
  return undefined
}

/**
 * Propagate the app-level override (if set) to the SDK's env var. Call once
 * before the SDK module is imported.
 */
export function applyAgentDirOverride(): void {
  const override = resolveAgentDirOverride()
  if (override) process.env[SDK_AGENT_DIR_ENV] = override
}
