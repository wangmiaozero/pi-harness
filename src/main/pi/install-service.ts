/** Pi Coding Agent install/update lifecycle. All commands use argument arrays and stream output. */

import path from 'node:path'
import { piProcess } from '../process/pi-process'
import { log } from '../services/logger'
import { AppError, EnvironmentError, PiCliError, ValidationError } from '../services/errors'
import type { PiInstallResult, PiLatestInfo } from '@shared/ipc/api-types'
import { PI_INSTALL_ARGS, PI_INSTALL_COMMAND, PI_NPM_PACKAGE } from '@shared/constants/pi-install'
import { detectNodeRuntime, MINIMUM_NODE_VERSION, resolveNpmExecutable } from './node-environment'
import { displayCommand, runCommand, type CommandRunOptions } from '../environment/command-runner'
import {
  ensureWritableNpmPrefix,
  npmEnvironment,
  type WritableNpmEnvironment
} from '../environment/npm-environment'
import { refreshRuntimePath } from '../environment/path-manager'

export { PI_NPM_PACKAGE } from '@shared/constants/pi-install'

export interface PiInstallProgress {
  phase: string
  progress: number
  message: string
}

export interface PiInstallOptions {
  force?: boolean
  signal?: AbortSignal
  onProgress?: (progress: PiInstallProgress) => void
  onLog?: (message: string, level?: 'info' | 'stdout' | 'stderr' | 'warning') => void
}

interface PiInstallDependencies {
  resolveNpm: typeof resolveNpmExecutable
  detectRuntime: typeof detectNodeRuntime
  runCommand: typeof runCommand
  ensurePrefix: typeof ensureWritableNpmPrefix
  refreshPath: typeof refreshRuntimePath
}

function parseSemverHint(text: string): string | null {
  const match = text.trim().match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)
  return match?.[1] ?? null
}

export class PiInstallService {
  private readonly dependencies: PiInstallDependencies

  constructor(dependencies: Partial<PiInstallDependencies> = {}) {
    this.dependencies = {
      resolveNpm: resolveNpmExecutable,
      detectRuntime: detectNodeRuntime,
      runCommand,
      ensurePrefix: ensureWritableNpmPrefix,
      refreshPath: refreshRuntimePath,
      ...dependencies
    }
  }

  async checkLatest(): Promise<PiLatestInfo> {
    const installedPath = await piProcess.resolveCliPath()
    if (!installedPath) {
      return {
        installed: false,
        installedVersion: null,
        latestVersion: null,
        updateAvailable: false,
        packageName: PI_NPM_PACKAGE
      }
    }

    const installedVersion = await piProcess.version()
    const installedClean = installedVersion ? parseSemverHint(installedVersion) : null
    let latestVersion: string | null = null
    try {
      const npm = await this.dependencies.resolveNpm()
      const result = await this.dependencies.runCommand(
        npm,
        ['view', PI_NPM_PACKAGE, 'version', '--json'],
        { timeoutMs: 30_000, env: npmEnvironment() }
      )
      if (result.exitCode === 0) {
        const raw = result.stdout.trim()
        try {
          const parsed = JSON.parse(raw) as string
          latestVersion = typeof parsed === 'string' ? parsed : parseSemverHint(raw)
        } catch {
          latestVersion = parseSemverHint(raw)
        }
      } else {
        log.pi.warn('npm view failed:', result.stderr || result.stdout)
      }
    } catch (error) {
      log.pi.warn('checkLatest failed:', error)
    }

    return {
      installed: true,
      installedVersion: installedClean ?? installedVersion,
      latestVersion,
      updateAvailable: Boolean(installedClean && latestVersion && installedClean !== latestVersion),
      packageName: PI_NPM_PACKAGE
    }
  }

  async install(options: PiInstallOptions = {}): Promise<PiInstallResult> {
    const existing = await piProcess.resolveCliPath()
    const previousVersion = existing ? await piProcess.version() : null
    if (existing && !options.force) {
      throw new ValidationError('Pi is already installed. Use Update or Reinstall instead.', {
        cliPath: existing
      })
    }
    const progress = (phase: string, value: number, message: string) => {
      options.onProgress?.({ phase, progress: value, message })
      options.onLog?.(message, 'info')
    }
    progress('checking-node', 5, `Checking Node.js >= ${MINIMUM_NODE_VERSION}`)
    const runtime = await this.dependencies.detectRuntime()
    if (!runtime.nodeInstalled) {
      throw new EnvironmentError('NODE_NOT_FOUND', 'Node.js is required before installing Pi')
    }
    if (!runtime.nodeSupported) {
      throw new EnvironmentError(
        'NODE_VERSION_TOO_LOW',
        `Pi-Harness requires Node.js >= ${MINIMUM_NODE_VERSION}`,
        { version: runtime.nodeVersion }
      )
    }
    if (!runtime.npmInstalled || !runtime.npmPath) {
      throw new EnvironmentError('NPM_NOT_FOUND', 'npm is unavailable; repair Node.js first')
    }

    progress('checking-npm', 15, `Using npm ${runtime.npmVersion ?? ''}`.trim())
    progress('checking-npm-permissions', 20, 'Checking npm global prefix permissions')
    let prefix: WritableNpmEnvironment
    try {
      prefix = await this.dependencies.ensurePrefix(runtime.npmPath, {
        nodePath: runtime.nodePath,
        signal: options.signal,
        onLog: (message) => options.onLog?.(message, 'info')
      })
    } catch (error) {
      throw normalizeNpmCommandError(error)
    }
    progress('preparing-pi-install', 25, `Executing ${PI_INSTALL_COMMAND}`)
    log.pi.info('installing Pi via npm', {
      package: PI_NPM_PACKAGE,
      npm: runtime.npmPath,
      command: PI_INSTALL_COMMAND,
      prefix: prefix.prefix
    })
    const commandOptions: CommandRunOptions = {
      timeoutMs: 10 * 60_000,
      signal: options.signal,
      env: prefix.env,
      onStdout: (chunk) => options.onLog?.(chunk.trimEnd(), 'stdout'),
      onStderr: (chunk) => options.onLog?.(chunk.trimEnd(), 'stderr')
    }
    progress('installing-pi', 35, 'Installing Pi Coding Agent with npm')
    let result
    try {
      result = await this.dependencies.runCommand(
        runtime.npmPath,
        [...PI_INSTALL_ARGS],
        commandOptions
      )
    } catch (error) {
      if (options.signal?.aborted) {
        throw new EnvironmentError('INSTALL_CANCELLED', 'Pi installation was cancelled')
      }
      throw normalizeNpmCommandError(error)
    }
    if (result.exitCode !== 0)
      throw classifyNpmFailure(result.stderr, result.stdout, result.exitCode)

    progress('resolving-pi', 82, 'npm install completed; resolving the Pi executable')
    const pathDirectories = [
      runtime.nodePath ? path.dirname(runtime.nodePath) : null,
      prefix.binDir
    ].filter(Boolean) as string[]
    await this.dependencies.refreshPath(pathDirectories)
    piProcess.invalidateCache()
    let cliPath = await piProcess.resolveCliPath()
    if (!cliPath && prefix.binDir) {
      cliPath = await resolvePiFromPrefix(prefix)
    }
    if (!cliPath) {
      throw new EnvironmentError(
        'PI_NOT_FOUND_AFTER_INSTALL',
        'Pi was installed but its executable was not found after refreshing PATH',
        { prefix: prefix.prefix, binDir: prefix.binDir }
      )
    }

    progress('verifying-pi', 92, `Verifying ${cliPath}`)
    piProcess.invalidateCache()
    const currentVersion = await piProcess.version()
    if (!currentVersion) {
      throw new EnvironmentError(
        'PI_NOT_FOUND_AFTER_INSTALL',
        'Pi executable exists but `pi --version` failed',
        { cliPath }
      )
    }
    progress('refreshing-environment', 98, 'Refreshing Pi-Harness environment state')
    const parsedVersion = parseSemverHint(currentVersion) ?? currentVersion
    progress('pi-ready', 100, `Pi Coding Agent ${parsedVersion} is ready`)
    return {
      ok: true,
      action: 'install',
      previousVersion,
      currentVersion: parsedVersion,
      latestVersion: null,
      message: `${options.force ? 'Reinstalled' : 'Installed'} Pi ${parsedVersion}`,
      log: [displayCommand(runtime.npmPath, [...PI_INSTALL_ARGS]), result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n')
        .slice(0, 8_000)
    }
  }

  async update(force = false, options: PiInstallOptions = {}): Promise<PiInstallResult> {
    const cliPath = await piProcess.resolveCliPath()
    if (!cliPath) throw new ValidationError('Pi is not installed. Use Install first.')
    const previousVersion = await piProcess.version()
    if (isProjectLocalPiShim(cliPath)) {
      options.onLog?.(
        'The active Pi executable belongs to this project; updating the user installation with npm instead.',
        'warning'
      )
      const installed = await this.install({ ...options, force: true })
      const previous = parseSemverHint(previousVersion ?? '') ?? previousVersion
      return {
        ...installed,
        action: 'update',
        previousVersion: previous,
        message:
          previous !== installed.currentVersion
            ? `Updated Pi ${previous ?? '?'} → ${installed.currentVersion ?? '?'}`
            : `Pi is already up to date (${installed.currentVersion ?? previousVersion ?? '?'})`
      }
    }
    const args = force ? ['update', '--self', '--force'] : ['update', '--self']
    log.pi.info('updating Pi', { cliPath, args })
    const isJavaScript = cliPath.endsWith('.js')
    const executable = isJavaScript ? process.execPath : cliPath
    const executableArgs = isJavaScript ? [cliPath, ...args] : args
    options.onProgress?.({
      phase: 'running-pi-update',
      progress: 25,
      message: `Executing ${displayCommand(cliPath, args)}`
    })
    const result = await this.dependencies.runCommand(executable, executableArgs, {
      timeoutMs: 5 * 60_000,
      signal: options.signal,
      env: isJavaScript ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
      onStdout: (chunk) => options.onLog?.(chunk.trimEnd(), 'stdout'),
      onStderr: (chunk) => options.onLog?.(chunk.trimEnd(), 'stderr')
    })
    piProcess.invalidateCache()
    options.onProgress?.({
      phase: 'verifying-pi',
      progress: 90,
      message: 'Verifying the updated Pi Coding Agent'
    })
    const currentVersion = await piProcess.version()
    if (result.exitCode !== 0) {
      throw new PiCliError('Pi update failed', {
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 2000),
        stdout: result.stdout.slice(0, 1000)
      })
    }
    const previous = parseSemverHint(previousVersion ?? '') ?? previousVersion
    const current = parseSemverHint(currentVersion ?? '') ?? currentVersion
    return {
      ok: true,
      action: 'update',
      previousVersion: previous,
      currentVersion: current,
      latestVersion: null,
      message:
        previous !== current
          ? `Updated Pi ${previous ?? '?'} → ${current ?? '?'}`
          : `Pi is already up to date (${current ?? previousVersion ?? '?'})`,
      log: `${result.stdout}\n${result.stderr}`.trim().slice(0, 4000)
    }
  }
}

function isProjectLocalPiShim(cliPath: string): boolean {
  const normalized = path.resolve(cliPath).replace(/\\/g, '/')
  return /\/node_modules\/\.bin\/pi(?:\.(?:cmd|bat|exe))?$/i.test(normalized)
}

function classifyNpmFailure(stderr: string, stdout: string, exitCode: number): EnvironmentError {
  const combined = `${stderr}\n${stdout}`
  const details = { exitCode, stderr: stderr.slice(0, 2500), stdout: stdout.slice(0, 1000) }
  if (/EACCES|permission denied|operation not permitted/i.test(combined)) {
    return new EnvironmentError(
      'NPM_PERMISSION_DENIED',
      'npm global installation was denied by filesystem permissions',
      details
    )
  }
  if (/ETIMEDOUT|ECONNRESET|ENETUNREACH|EAI_AGAIN|ENOTFOUND/i.test(combined)) {
    return new EnvironmentError(
      'NETWORK_ERROR',
      'Network connection failed during npm install',
      details
    )
  }
  if (/ENOENT|not recognized as an internal|command not found/i.test(combined)) {
    return new EnvironmentError(
      'NPM_NOT_FOUND',
      'npm became unavailable during installation',
      details
    )
  }
  return new EnvironmentError(
    'NPM_INSTALL_FAILED',
    'npm failed to install Pi Coding Agent',
    details
  )
}

function normalizeNpmCommandError(error: unknown): unknown {
  const details =
    error instanceof AppError ? (error.details as { code?: string } | undefined) : null
  if (error instanceof AppError && error.code === 'COMMAND_FAILED' && details?.code === 'ENOENT') {
    return new EnvironmentError(
      'NPM_NOT_FOUND',
      'npm became unavailable; the Node.js runtime must be repaired',
      details
    )
  }
  return error
}

async function resolvePiFromPrefix(prefix: WritableNpmEnvironment): Promise<string | null> {
  if (!prefix.binDir) return null
  const candidates =
    process.platform === 'win32'
      ? ['pi.cmd', 'pi.exe', 'pi.bat'].map((name) => path.join(prefix.binDir!, name))
      : [path.join(prefix.binDir, 'pi')]
  for (const candidate of candidates) {
    try {
      const fs = await import('node:fs/promises')
      await fs.access(
        candidate,
        process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK
      )
      return candidate
    } catch {
      // Try next generated launcher.
    }
  }
  return null
}

export const piInstall = new PiInstallService()
