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

const execFileP = promisify(execFile)

function toStr(v: string | Buffer): string {
  return typeof v === 'string' ? v : v.toString('utf8')
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
}

export class PiProcessService {
  private cachedPath: string | null = null
  private cachedAt = 0
  private readonly cacheTtlMs = 10_000

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

    // 1. explicit override / cache / candidate dirs
    if (override?.trim()) {
      const found = await checkExplicitPath(override.trim())
      if (found) return this.setCache(found)
    }
    for (const dir of await this.candidateDirs()) {
      const basename = path.basename(dir).toLowerCase()
      const isFilePath = ['pi', 'pi.exe', 'pi.cmd', 'pi.bat', 'cli.js'].includes(basename)
      if (isFilePath) {
        const found = await checkExplicitPath(dir)
        if (found) return this.setCache(found)
        continue
      }

      const executableNames = process.platform === 'win32' ? ['pi.exe', 'pi.cmd', 'pi.bat'] : ['pi']
      for (const name of executableNames) {
        const found = await check(path.join(dir, name))
        if (found) return this.setCache(found)
      }
      const js = path.join(dir, 'cli.js')
      const foundJs = await check(js)
      if (foundJs) return this.setCache(foundJs)
    }

    // 2. last resort: PATH lookup via `which` / `where` (execFile, no shell)
    const which = process.platform === 'win32' ? 'where' : 'which'
    try {
      const { stdout } = await execFileP(which, ['pi'], { timeout: 5000 })
      const matches = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      const first =
        process.platform === 'win32'
          ? matches.find((file) => /\.(?:exe|cmd|bat)$/i.test(file))
          : matches[0]
      if (first) return this.setCache(first)
    } catch {
      log.pi.debug('Pi executable not found on PATH')
    }

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
  }

  /** Run `pi <args>` safely. Returns captured output. */
  async exec(options: PiExecOptions): Promise<PiExecResult> {
    const cliPath = await this.resolveCliPath()
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
      env: { ...process.env, ...options.env },
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
