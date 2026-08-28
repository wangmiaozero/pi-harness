/**
 * PiProcessService — runs the Pi Coding Agent CLI safely.
 *
 * Uses execFile with an argument array everywhere. User input is never
 * concatenated into a shell string. Every call has a timeout, captured
 * stdout/stderr/exit code, and stderr sanitisation.
 */

import { execFile, type ExecFileOptions } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { homedir } from 'node:os'
import fs from 'node:fs/promises'
import { log } from '../services/logger'
import { PiCliError, PiCliMissingError } from '../services/errors'
import { nodeToolDirectories } from '../pi/node-environment'
import { resolveExecutable, resolveLoginShellPath } from '../environment/command-resolver'

const execFileP = promisify(execFile)

function toStr(v: string | Buffer): string {
  return typeof v === 'string' ? v : v.toString('utf8')
}

/** Deduplicate path entries, preserving first-seen precedence. */
function mergePathEntries(...values: Array<string | null | undefined>): string {
  const seen = new Set<string>()
  const entries: string[] = []
  for (const value of values) {
    for (const entry of (value ?? '').split(path.delimiter)) {
      const trimmed = entry.trim()
      if (!trimmed) continue
      const identity = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
      if (seen.has(identity)) continue
      seen.add(identity)
      entries.push(trimmed)
    }
  }
  return entries.join(path.delimiter)
}

export interface PiExecResult {
  stdout: string
  stderr: string
  exitCode: number
  signal: NodeJS.Signals | null
}

export interface PiExecOptions {
  args: string[]
  timeoutMs?: number
  cwd?: string
  env?: Record<string, string>
  cliPath?: string | null
}

export class PiProcessService {
  private cachedPath: string | null = null
  private cachedAt = 0
  private readonly cacheTtlMs = 10_000

  private cachedSearchPath: string | null = null
  private searchPathCachedAt = 0
  private readonly searchPathTtlMs = 10 * 60_000

  private async candidateDirs(): Promise<string[]> {
    const home = homedir()
    const isWin = process.platform === 'win32'
    const dirs = [
      process.env.PI_HARNESS_PI_CLI_PATH?.trim() ||
        process.env.PI_SWITCH_PI_CLI_PATH?.trim() ||
        null,
      path.join(home, '.npm-global', 'bin'),
      path.join(
        home,
        '.npm-global',
        'lib',
        'node_modules',
        '@earendil-works',
        'pi-coding-agent',
        'dist'
      ),
      path.join(home, '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      ...(await nodeToolDirectories()),
      ...(process.env.PATH?.split(path.delimiter) ?? [])
    ].filter((d): d is string => Boolean(d))
    if (isWin) {
      dirs.push(path.join(home, 'AppData', 'Roaming', 'npm'))
      dirs.push(path.join(home, 'AppData', 'Roaming', 'npm', 'pi.cmd'))
    }
    return dirs
  }

  /** Find the pi executable path across platforms without relying on `which` alone. */
  async resolveCliPath(override?: string | null): Promise<string | null> {
    const now = Date.now()
    if (!override && this.cachedPath && now - this.cachedAt < this.cacheTtlMs)
      return this.cachedPath

    const check = async (file: string): Promise<string | null> => {
      try {
        await fs.access(file, fs.constants.X_OK | fs.constants.F_OK)
        return file
      } catch {
        return null
      }
    }

    const checkExplicitPath = async (file: string): Promise<string | null> => {
      if (process.platform !== 'win32') return check(file)
      if (path.extname(file)) return check(file)
      for (const candidate of [`${file}.exe`, `${file}.cmd`, `${file}.bat`]) {
        const found = await check(candidate)
        if (found) return found
      }
      return null
    }

    // An environment override is authoritative. This is required for packaged
    // automation and isolated tests: a missing explicit target must not fall
    // through to an unrelated Pi installation on the host machine.
    const environmentOverride =
      process.env.PI_HARNESS_PI_CLI_PATH?.trim() ||
      process.env.PI_SWITCH_PI_CLI_PATH?.trim() ||
      null
    if (!override?.trim() && environmentOverride) {
      const found = await checkExplicitPath(environmentOverride)
      return found ? this.setCache(found) : null
    }

    // 1. explicit override / cache / candidate dirs
    if (override?.trim()) {
      const found = await checkExplicitPath(override.trim())
      if (found) return this.setCache(found)
    }
    const candidateDirectories: string[] = []
    for (const dir of await this.candidateDirs()) {
      const basename = path.basename(dir).toLowerCase()
      const isFilePath = ['pi', 'pi.exe', 'pi.cmd', 'pi.bat', 'cli.js'].includes(basename)
      if (isFilePath) {
        const found = await checkExplicitPath(dir)
        if (found) return this.setCache(found)
        continue
      }
      candidateDirectories.push(dir)
      const js = path.join(dir, 'cli.js')
      const foundJs = await check(js)
      if (foundJs) return this.setCache(foundJs)
    }

    // 2. shared resolver adds process PATH, login-shell PATH, where/Get-Command/which fallbacks.
    const resolved = await resolveExecutable('pi', {
      additionalDirectories: candidateDirectories,
      versionArgs: ['--version']
    })
    if (resolved.path) return this.setCache(resolved.path)
    log.pi.debug('Pi executable not found in the resolved user environment')

    return null
  }

  private setCache(p: string): string {
    this.cachedPath = p
    this.cachedAt = Date.now()
    return p
  }

  invalidateCache(): void {
    this.cachedPath = null
    this.cachedAt = 0
    this.cachedSearchPath = null
    this.searchPathCachedAt = 0
  }

  /**
   * Search path handed to spawned Pi processes.
   *
   * Desktop apps launched from Finder/Dock/Spotlight inherit a minimal system
   * PATH, so the Pi CLI could not find `npm` for `pi install` (spawn ENOENT)
   * even though the login shell has it. Merge the inherited PATH with the
   * resolved login-shell PATH and the known Node tool directories so child
   * processes work regardless of how the app was launched.
   */
  private async resolveChildSearchPath(): Promise<string> {
    const now = Date.now()
    if (this.cachedSearchPath && now - this.searchPathCachedAt < this.searchPathTtlMs) {
      return this.cachedSearchPath
    }
    const login = await resolveLoginShellPath()
    const directories = await nodeToolDirectories(login.path)
    const merged = mergePathEntries(process.env.PATH, login.path, ...directories)
    this.cachedSearchPath = merged
    this.searchPathCachedAt = now
    return merged
  }

  /** Run `pi <args>` safely. Returns captured output. */
  async exec(options: PiExecOptions): Promise<PiExecResult> {
    const cliPath = await this.resolveCliPath(options.cliPath)
    if (!cliPath) throw new PiCliMissingError()

    const isJs = cliPath.endsWith('.js')
    const isWindowsShim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(cliPath)
    const file = isJs
      ? process.execPath
      : isWindowsShim
        ? (process.env.ComSpec ?? 'cmd.exe')
        : cliPath
    const args = isJs
      ? [cliPath, ...options.args]
      : isWindowsShim
        ? ['/d', '/s', '/c', cliPath, ...options.args]
        : options.args

    const execOptions: ExecFileOptions = {
      timeout: options.timeoutMs ?? 30_000,
      cwd: options.cwd,
      env: {
        ...process.env,
        PATH: await this.resolveChildSearchPath(),
        ...options.env,
        ...(isJs ? { ELECTRON_RUN_AS_NODE: '1' } : {})
      },
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    }

    try {
      const { stdout, stderr } = await execFileP(file, args, execOptions)
      const code = 0
      log.pi.debug(`pi ${options.args.join(' ')} → exit ${code}`)
      return {
        stdout: toStr(stdout),
        stderr: this.sanitize(toStr(stderr)),
        exitCode: code,
        signal: null
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException & {
        stdout?: string | Buffer
        stderr?: string | Buffer
        code?: number | string
        signal?: NodeJS.Signals
      }
      if (e.signal === 'SIGTERM' || (typeof e.code === 'string' && e.code.includes('TIMEDOUT'))) {
        throw new PiCliError(`Pi command timed out after ${options.timeoutMs ?? 30000}ms`)
      }
      // Non-zero exit: still surface stdout/stderr for version/help probes.
      if (typeof e.code === 'number') {
        return {
          stdout: toStr(e.stdout ?? ''),
          stderr: this.sanitize(toStr(e.stderr ?? '')),
          exitCode: e.code,
          signal: e.signal ?? null
        }
      }
      throw new PiCliError(`Failed to execute pi: ${e.message}`, { args: options.args })
    }
  }

  /** Strip anything that looks like a credential from stderr. */
  private sanitize(s: string): string {
    return s.replace(/(?:sk-[a-zA-Z0-9-]{6,}|Bearer [^\s]+)/gi, '[redacted]')
  }

  async version(): Promise<string | null> {
    try {
      const res = await this.exec({ args: ['--version'], timeoutMs: 8000 })
      const v = (res.stdout || res.stderr).trim()
      return v || null
    } catch {
      return null
    }
  }

  async help(): Promise<string> {
    const res = await this.exec({ args: ['--help'], timeoutMs: 8000 })
    return res.stdout
  }
}

export const piProcess = new PiProcessService()
