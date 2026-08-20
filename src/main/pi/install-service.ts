/**
 * PiInstallService — install / update the Pi Coding Agent CLI.
 *
 * Install:  npm install -g @earendil-works/pi-coding-agent  (only when missing)
 * Update:   pi update --self                                 (only when present)
 */

import { execFile, type ExecFileOptions } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { homedir } from 'node:os'
import fs from 'node:fs/promises'
import { piProcess } from '../process/pi-process'
import { log } from '../services/logger'
import { PiCliError, ValidationError } from '../services/errors'
import type { PiInstallResult, PiLatestInfo } from '@shared/ipc/api-types'

const execFileP = promisify(execFile)

export const PI_NPM_PACKAGE = '@earendil-works/pi-coding-agent'

function toStr(v: string | Buffer): string {
  return typeof v === 'string' ? v : v.toString('utf8')
}

function sanitize(s: string): string {
  return s.replace(/(?:sk-[a-zA-Z0-9-]{6,}|Bearer [^\s]+)/gi, '[redacted]')
}

function npmCandidates(): string[] {
  const home = homedir()
  const isWin = process.platform === 'win32'
  const names = isWin ? ['npm.exe', 'npm.cmd', 'npm'] : ['npm']
  const dirs = [
    path.dirname(process.execPath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.local', 'bin'),
    ...(process.env.PATH?.split(path.delimiter) ?? [])
  ]
  const out: string[] = []
  for (const dir of dirs) {
    for (const name of names) {
      out.push(path.join(dir, name))
    }
  }
  return out
}

async function resolveNpm(): Promise<string> {
  for (const candidate of npmCandidates()) {
    try {
      await fs.access(candidate, fs.constants.X_OK | fs.constants.F_OK)
      return candidate
    } catch {
      /* next */
    }
  }
  const which = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileP(which, ['npm'], { timeout: 5000 })
    const first = stdout
      .split(/\r?\n/)
      .find((l) => l.trim())
      ?.trim()
    if (first) return first
  } catch {
    /* fallthrough */
  }
  throw new PiCliError('npm not found — install Node.js / npm first')
}

async function run(
  file: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const isWindowsShim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(file)
  const executable = isWindowsShim ? (process.env.ComSpec ?? 'cmd.exe') : file
  const executableArgs = isWindowsShim ? ['/d', '/s', '/c', file, ...args] : args
  const opts: ExecFileOptions = {
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false' }
  }
  try {
    const { stdout, stderr } = await execFileP(executable, executableArgs, opts)
    return { stdout: toStr(stdout), stderr: sanitize(toStr(stderr)), exitCode: 0 }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string | Buffer
      stderr?: string | Buffer
      code?: number | string
      signal?: NodeJS.Signals
    }
    if (e.signal === 'SIGTERM' || (typeof e.code === 'string' && e.code.includes('TIMEDOUT'))) {
      throw new PiCliError(`Command timed out after ${timeoutMs}ms: ${file} ${args.join(' ')}`)
    }
    if (typeof e.code === 'number') {
      return {
        stdout: toStr(e.stdout ?? ''),
        stderr: sanitize(toStr(e.stderr ?? '')),
        exitCode: e.code
      }
    }
    throw new PiCliError(`Failed to run ${file}: ${e.message}`, { args })
  }
}

function parseSemverHint(text: string): string | null {
  const m = text.trim().match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)
  return m?.[1] ?? null
}

export class PiInstallService {
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
      const npm = await resolveNpm()
      const res = await run(npm, ['view', PI_NPM_PACKAGE, 'version', '--json'], 30_000)
      if (res.exitCode === 0) {
        const raw = res.stdout.trim()
        try {
          const parsed = JSON.parse(raw) as string
          latestVersion = typeof parsed === 'string' ? parsed : parseSemverHint(raw)
        } catch {
          latestVersion = parseSemverHint(raw)
        }
      } else {
        log.pi.warn('npm view failed:', res.stderr || res.stdout)
      }
    } catch (err) {
      log.pi.warn('checkLatest failed:', err)
    }

    const updateAvailable = Boolean(
      installedClean && latestVersion && installedClean !== latestVersion
    )

    return {
      installed: true,
      installedVersion: installedClean ?? installedVersion,
      latestVersion,
      updateAvailable,
      packageName: PI_NPM_PACKAGE
    }
  }

  /** One-click install — refused if Pi is already present. */
  async install(): Promise<PiInstallResult> {
    const existing = await piProcess.resolveCliPath()
    if (existing) {
      throw new ValidationError('Pi is already installed. Use Update instead.', {
        cliPath: existing
      })
    }

    const npm = await resolveNpm()
    log.pi.info('installing Pi via npm', { package: PI_NPM_PACKAGE, npm })
    const res = await run(npm, ['install', '-g', PI_NPM_PACKAGE], 5 * 60_000)

    piProcess.invalidateCache()
    const cliPath = await piProcess.resolveCliPath()
    const currentVersion = cliPath ? await piProcess.version() : null

    if (res.exitCode !== 0 || !cliPath) {
      throw new PiCliError('Pi install failed', {
        exitCode: res.exitCode,
        stderr: res.stderr.slice(0, 2000),
        stdout: res.stdout.slice(0, 1000)
      })
    }

    return {
      ok: true,
      action: 'install',
      previousVersion: null,
      currentVersion: parseSemverHint(currentVersion ?? '') ?? currentVersion,
      latestVersion: null,
      message: `Installed Pi ${currentVersion ?? ''}`.trim(),
      log: sanitize((res.stdout + '\n' + res.stderr).trim()).slice(0, 4000)
    }
  }

  /** Update Pi in place via `pi update --self`. */
  async update(force = false): Promise<PiInstallResult> {
    const cliPath = await piProcess.resolveCliPath()
    if (!cliPath) {
      throw new ValidationError('Pi is not installed. Use Install first.')
    }

    const previousVersion = await piProcess.version()
    const args = force ? ['update', '--self', '--force'] : ['update', '--self']
    log.pi.info('updating Pi', { cliPath, args })

    const isJs = cliPath.endsWith('.js')
    const file = isJs ? process.execPath : cliPath
    const execArgs = isJs ? [cliPath, ...args] : args
    const res = await run(file, execArgs, 5 * 60_000)

    piProcess.invalidateCache()
    const currentVersion = await piProcess.version()

    if (res.exitCode !== 0) {
      throw new PiCliError('Pi update failed', {
        exitCode: res.exitCode,
        stderr: res.stderr.slice(0, 2000),
        stdout: res.stdout.slice(0, 1000)
      })
    }

    const prev = parseSemverHint(previousVersion ?? '') ?? previousVersion
    const curr = parseSemverHint(currentVersion ?? '') ?? currentVersion
    const changed = prev !== curr

    return {
      ok: true,
      action: 'update',
      previousVersion: prev,
      currentVersion: curr,
      latestVersion: null,
      message: changed
        ? `Updated Pi ${prev ?? '?'} → ${curr ?? '?'}`
        : `Pi is already up to date (${curr ?? previousVersion ?? '?'})`,
      log: sanitize((res.stdout + '\n' + res.stderr).trim()).slice(0, 4000)
    }
  }
}

export const piInstall = new PiInstallService()
