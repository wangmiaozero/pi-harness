/**
 * DeepSeek Harness installation detection.
 *
 * The adapter never guesses package internals: it drives the official `dsh`
 * CLI (`@deepseek-ai/dsh` on npm) with its documented `-V/--version` flag.
 * Detection order: user-configured command → `dsh` on PATH → npm global bin.
 * "Not installed" is a normal, healthy state — DeepSeek ships disabled by
 * default and the user opts in explicitly.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { safeSpawn } from './spawn-safe'

export interface DeepSeekDetection {
  status: 'installed' | 'not-installed'
  executablePath: string | null
  version: string | null
  /** How the executable was found; null when not found. */
  source: 'custom' | 'path' | 'npm-global' | null
  message: string | null
}

export interface DeepSeekDetectOptions {
  /** User-configured `dsh` executable path from runtime settings. */
  customPath?: string | null
  /** Environment override used by tests; defaults to process.env. */
  env?: Record<string, string>
  platform?: NodeJS.Platform
}

/** The ACP server invocation documented by DeepSeek Harness: `dsh --profile acp`. */
export function acpServerArgs(): string[] {
  return ['--profile', 'acp']
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** npm global bin candidates for the `dsh` executable, per platform. */
async function npmGlobalCandidates(env: Record<string, string>): Promise<string[]> {
  const candidates: string[] = []
  const prefix = env.NPM_CONFIG_PREFIX
  if (prefix) candidates.push(path.join(prefix, 'bin', 'dsh'), path.join(prefix, 'dsh.cmd'))
  const npmHome = env['APPDATA']
    ? path.join(env['APPDATA'], 'npm')
    : env.HOME
      ? path.join(env.HOME, '.npm-global')
      : null
  if (npmHome) {
    candidates.push(
      path.join(npmHome, 'dsh'),
      path.join(npmHome, 'dsh.cmd'),
      path.join(npmHome, 'dsh.bat')
    )
  }
  return candidates
}

/** Resolve one spawnable command for `dsh` per detection source order. */
export async function resolveDshCommand(
  options: DeepSeekDetectOptions = {}
): Promise<{ command: string; source: DeepSeekDetection['source'] } | null> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const exe = platform === 'win32' ? 'dsh.cmd' : 'dsh'

  if (options.customPath && options.customPath.trim()) {
    const custom = options.customPath.trim()
    if (await isExecutable(custom)) return { command: custom, source: 'custom' }
  }
  // PATH lookup: spawn resolves the executable for us; verify it exists first
  // only when the entry is absolute.
  const pathDirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const dir of pathDirs) {
    const candidate = path.join(dir, exe)
    if (await isExecutable(candidate)) return { command: candidate, source: 'path' }
  }
  if (platform === 'win32') {
    for (const dir of pathDirs) {
      const candidate = path.join(dir, 'dsh.bat')
      if (await isExecutable(candidate)) return { command: candidate, source: 'path' }
    }
  }
  for (const candidate of await npmGlobalCandidates(env)) {
    if (await isExecutable(candidate)) return { command: candidate, source: 'npm-global' }
  }
  return null
}

/** Probe `dsh --version` to confirm a working installation. */
export async function detectDeepSeekHarness(
  options: DeepSeekDetectOptions = {}
): Promise<DeepSeekDetection> {
  const resolved = await resolveDshCommand(options)
  const notInstalled = (message: string): DeepSeekDetection => ({
    status: 'not-installed',
    executablePath: null,
    version: null,
    source: null,
    message
  })
  if (!resolved) {
    return notInstalled(
      'DeepSeek Harness (dsh) is not installed. Install the official npm package @deepseek-ai/dsh, then enable this runtime here.'
    )
  }
  try {
    const result = await safeSpawn({
      command: resolved.command,
      args: ['--version'],
      env: options.env ?? process.env,
      timeoutMs: 15_000,
      maxBufferChars: 10_000
    })
    if (result.timedOut) {
      return notInstalled('DeepSeek Harness version check timed out.')
    }
    if (result.exitCode !== 0) {
      return notInstalled(
        `dsh --version exited with ${result.exitCode}${result.stderr ? `: ${result.stderr.trim().slice(0, 200)}` : ''}`
      )
    }
    const version = result.stdout.trim().split('\n')[0]?.trim() || null
    return {
      status: 'installed',
      executablePath: resolved.command,
      version,
      source: resolved.source,
      message: null
    }
  } catch (error) {
    return notInstalled(
      `DeepSeek Harness probe failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
