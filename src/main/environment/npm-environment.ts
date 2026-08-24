import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import type { CommandRunResult } from './command-runner'
import { runCommand } from './command-runner'
import { EnvironmentError } from '../services/errors'
import { environmentBackupDir, npmUserPrefix } from '../services/app-paths'
import { persistUserPath } from './path-manager'

export interface NpmPrefixStatus {
  prefix: string | null
  binDir: string | null
  writable: boolean | null
}

export interface WritableNpmEnvironment extends NpmPrefixStatus {
  env: NodeJS.ProcessEnv
  changed: boolean
  previousPrefix: string | null
}

export async function inspectNpmPrefix(
  npmPath: string,
  options: { nodePath?: string | null; env?: NodeJS.ProcessEnv } = {}
): Promise<NpmPrefixStatus> {
  const result = await runNpm(npmPath, ['config', 'get', 'prefix'], {
    nodePath: options.nodePath,
    env: options.env,
    timeoutMs: 15_000
  }).catch(() => null)
  if (!result || result.exitCode !== 0) return { prefix: null, binDir: null, writable: null }
  const value = result.stdout.trim().split(/\r?\n/).find(Boolean)?.trim()
  if (!value || value === 'undefined' || value === 'null') {
    return { prefix: null, binDir: null, writable: null }
  }
  const prefix = path.resolve(value)
  return {
    prefix,
    binDir: npmBinDirectory(prefix),
    writable: await npmPrefixWritable(prefix)
  }
}

export async function ensureWritableNpmPrefix(
  npmPath: string,
  options: {
    nodePath?: string | null
    signal?: AbortSignal
    onLog?: (message: string) => void
    backupRoot?: string
    userPrefix?: string
    inspectPrefix?: typeof inspectNpmPrefix
    runNpmCommand?: typeof runNpm
    persistPath?: typeof persistUserPath
    backupConfig?: (backupRoot: string) => Promise<void>
  } = {}
): Promise<WritableNpmEnvironment> {
  const inspectPrefix = options.inspectPrefix ?? inspectNpmPrefix
  const runNpmCommand = options.runNpmCommand ?? runNpm
  const persistPath = options.persistPath ?? persistUserPath
  const backupConfig = options.backupConfig ?? backupNpmConfig
  const current = await inspectPrefix(npmPath, { nodePath: options.nodePath })
  if (current.prefix && current.writable) {
    options.onLog?.(`npm global prefix is writable: ${current.prefix}`)
    return {
      ...current,
      env: npmEnvironment(options.nodePath, current.prefix),
      changed: false,
      previousPrefix: current.prefix
    }
  }

  const prefix = path.resolve(options.userPrefix ?? npmUserPrefix())
  const binDir = npmBinDirectory(prefix)
  options.onLog?.(
    current.prefix
      ? `npm global prefix is not writable: ${current.prefix}`
      : 'npm global prefix could not be resolved'
  )
  options.onLog?.(`Switching npm to user prefix: ${prefix}`)
  await Promise.all([
    fs.mkdir(binDir, { recursive: true }),
    fs.mkdir(npmModulesDirectory(prefix), { recursive: true })
  ])
  await backupConfig(options.backupRoot ?? environmentBackupDir())
  const env = npmEnvironment(options.nodePath, prefix)
  const result = await runNpmCommand(npmPath, ['config', 'set', 'prefix', prefix], {
    nodePath: options.nodePath,
    env,
    signal: options.signal,
    timeoutMs: 30_000
  })
  if (result.exitCode !== 0) {
    throw new EnvironmentError('NPM_PERMISSION_DENIED', 'Could not configure user npm prefix', {
      previousPrefix: current.prefix,
      prefix,
      stderr: result.stderr.slice(0, 1500)
    })
  }
  await persistPath([binDir], {
    backupRoot: options.backupRoot,
    signal: options.signal
  })
  const verified = await inspectPrefix(npmPath, { nodePath: options.nodePath, env })
  if (verified.prefix !== prefix || verified.writable !== true) {
    throw new EnvironmentError('NPM_PERMISSION_DENIED', 'User npm prefix verification failed', {
      expected: prefix,
      actual: verified.prefix
    })
  }
  return {
    ...verified,
    env,
    changed: true,
    previousPrefix: current.prefix
  }
}

export function npmEnvironment(
  nodePath?: string | null,
  prefix?: string | null,
  parentEnvironment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const bin = prefix ? npmBinDirectory(prefix) : null
  return {
    ...withoutInheritedNpmConfig(parentEnvironment),
    PATH: [nodePath ? path.dirname(nodePath) : null, bin, parentEnvironment.PATH]
      .filter(Boolean)
      .join(path.delimiter),
    ...(prefix ? { NPM_CONFIG_PREFIX: prefix } : {}),
    npm_config_fund: 'false',
    npm_config_audit: 'false'
  }
}

function withoutInheritedNpmConfig(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...environment }
  for (const key of Object.keys(clean)) {
    if (/^npm_config_/i.test(key)) clean[key] = undefined
  }
  return clean
}

export function runNpm(
  npmPath: string,
  args: string[],
  options: {
    nodePath?: string | null
    env?: NodeJS.ProcessEnv
    signal?: AbortSignal
    timeoutMs?: number
    onStdout?: (chunk: string) => void
    onStderr?: (chunk: string) => void
  } = {}
): Promise<CommandRunResult> {
  return runCommand(npmPath, args, {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    onStdout: options.onStdout,
    onStderr: options.onStderr,
    env: {
      ...npmEnvironment(options.nodePath),
      ...options.env
    }
  })
}

export function npmBinDirectory(prefix: string): string {
  return process.platform === 'win32' ? prefix : path.join(prefix, 'bin')
}

function npmModulesDirectory(prefix: string): string {
  return process.platform === 'win32'
    ? path.join(prefix, 'node_modules')
    : path.join(prefix, 'lib', 'node_modules')
}

async function npmPrefixWritable(prefix: string): Promise<boolean> {
  const targets = [prefix, npmBinDirectory(prefix), npmModulesDirectory(prefix)]
  for (const target of targets) {
    if (!(await existingAncestorWritable(target))) return false
  }
  return true
}

async function existingAncestorWritable(target: string): Promise<boolean> {
  let current = path.resolve(target)
  while (true) {
    try {
      const stat = await fs.lstat(current)
      if (!stat.isDirectory()) return false
      await fs.access(current, fs.constants.W_OK)
      return true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code && code !== 'ENOENT') return false
      const parent = path.dirname(current)
      if (parent === current) return false
      current = parent
    }
  }
}

async function backupNpmConfig(backupRoot: string): Promise<void> {
  const npmrc = path.join(homedir(), '.npmrc')
  const stat = await fs.lstat(npmrc).catch(() => null)
  if (!stat?.isFile()) return
  await fs.mkdir(backupRoot, { recursive: true })
  await fs.copyFile(npmrc, path.join(backupRoot, `npmrc.${Date.now()}.bak`))
}
