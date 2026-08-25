import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { CommandResolutionSource } from '@shared/ipc/api-types'

const execFileP = promisify(execFile)
const COMMAND_PATTERN = /^[a-zA-Z0-9._-]+$/
const LOGIN_SHELL_PATH_MARKER = '__PI_HARNESS_PATH__'
const LOGIN_SHELL_EXECUTABLE_MARKER = '__PI_HARNESS_EXECUTABLE__'

export interface ResolvedExecutable {
  found: boolean
  command: string
  path: string | null
  version: string | null
  source: CommandResolutionSource | null
}

export interface ResolveExecutableOptions {
  explicitPath?: string | null
  explicitAuthoritative?: boolean
  additionalDirectories?: Array<{ path: string; source?: CommandResolutionSource } | string>
  versionArgs?: string[]
  loginShell?: boolean
}

export async function resolveExecutable(
  command: string,
  options: ResolveExecutableOptions = {}
): Promise<ResolvedExecutable> {
  if (!COMMAND_PATTERN.test(command)) throw new Error(`Invalid executable name: ${command}`)
  const versionArgs = options.versionArgs ?? ['--version']
  const explicit = options.explicitPath?.trim()
  if (explicit) {
    const explicitPath = await resolveExplicitPath(explicit, command)
    if (explicitPath) return resolved(command, explicitPath, 'explicit', versionArgs)
    if (options.explicitAuthoritative) return missing(command)
  }

  const seen = new Set<string>()
  for (const entry of options.additionalDirectories ?? []) {
    const directory = typeof entry === 'string' ? entry : entry.path
    const source = typeof entry === 'string' ? 'candidate' : (entry.source ?? 'candidate')
    const candidate = await resolveInDirectory(directory, command, seen)
    if (candidate) return resolved(command, candidate, source, versionArgs)
  }

  for (const directory of splitPath(process.env.PATH)) {
    const candidate = await resolveInDirectory(directory, command, seen)
    if (candidate) return resolved(command, candidate, 'process-path', versionArgs)
  }

  if (process.platform !== 'win32' && options.loginShell !== false) {
    const shellPath = await resolveFromLoginShell(command)
    if (shellPath) return resolved(command, shellPath, 'login-shell', versionArgs)
  }

  const systemPath = await resolveFromSystemLocator(command)
  if (systemPath) return resolved(command, systemPath, 'system-locator', versionArgs)
  return missing(command)
}

export async function resolveLoginShellPath(): Promise<{
  shell: string | null
  path: string | null
}> {
  if (process.platform === 'win32') {
    return { shell: process.env.ComSpec ?? null, path: process.env.PATH ?? null }
  }
  for (const shell of loginShellCandidates()) {
    try {
      const { stdout } = await execFileP(
        shell,
        [
          '-ilc',
          `printf '\n${LOGIN_SHELL_PATH_MARKER}%s\n' "$PATH"`
        ],
        {
          timeout: 8_000,
          windowsHide: true,
          env: process.env
        }
      )
      const value = markedShellOutput(stdout, LOGIN_SHELL_PATH_MARKER)
      if (value) return { shell, path: value }
    } catch {
      // Try the next supported login shell.
    }
  }
  return { shell: null, path: null }
}

export function mergeProcessPath(...pathValues: Array<string | null | undefined>): string {
  const entries: string[] = []
  const seen = new Set<string>()
  for (const value of pathValues) {
    for (const entry of splitPath(value)) {
      const identity = process.platform === 'win32' ? entry.toLowerCase() : entry
      if (seen.has(identity)) continue
      seen.add(identity)
      entries.push(entry)
    }
  }
  const merged = entries.join(path.delimiter)
  process.env.PATH = merged
  return merged
}

export async function readExecutableVersion(
  executable: string,
  args: string[] = ['--version'],
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const isWindowsShim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)
  const file = isWindowsShim ? (process.env.ComSpec ?? 'cmd.exe') : executable
  const fileArgs = isWindowsShim ? ['/d', '/s', '/c', executable, ...args] : args
  try {
    const { stdout, stderr } = await execFileP(file, fileArgs, {
      timeout: 8_000,
      windowsHide: true,
      env: {
        ...env,
        PATH: mergePathValues(path.dirname(executable), env.PATH)
      }
    })
    return `${stdout || stderr}`.trim().split(/\r?\n/).find(Boolean)?.trim() ?? null
  } catch {
    return null
  }
}

async function resolved(
  command: string,
  executable: string,
  source: CommandResolutionSource,
  versionArgs: string[]
): Promise<ResolvedExecutable> {
  return {
    found: true,
    command,
    path: executable,
    version: await readExecutableVersion(executable, versionArgs),
    source
  }
}

function missing(command: string): ResolvedExecutable {
  return { found: false, command, path: null, version: null, source: null }
}

async function resolveExplicitPath(value: string, command: string): Promise<string | null> {
  const candidate = path.resolve(value)
  if (await isExecutableFile(candidate)) return candidate
  const stat = await fs.lstat(candidate).catch(() => null)
  if (stat?.isDirectory()) return resolveInDirectory(candidate, command, new Set())
  if (process.platform === 'win32' && !path.extname(candidate)) {
    for (const extension of ['.exe', '.cmd', '.bat']) {
      if (await isExecutableFile(`${candidate}${extension}`)) return `${candidate}${extension}`
    }
  }
  return null
}

async function resolveInDirectory(
  directory: string,
  command: string,
  seen: Set<string>
): Promise<string | null> {
  if (!directory?.trim()) return null
  const absolute = path.resolve(directory)
  const identity = process.platform === 'win32' ? absolute.toLowerCase() : absolute
  if (seen.has(identity)) return null
  seen.add(identity)
  for (const name of executableNames(command)) {
    const candidate = path.join(absolute, name)
    if (await isExecutableFile(candidate)) return candidate
  }
  return null
}

async function isExecutableFile(file: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(file)
    if (!stat.isFile() && !stat.isSymbolicLink()) return false
    await fs.access(
      file,
      process.platform === 'win32' ? fs.constants.F_OK : fs.constants.F_OK | fs.constants.X_OK
    )
    return true
  } catch {
    return false
  }
}

async function resolveFromLoginShell(command: string): Promise<string | null> {
  for (const shell of loginShellCandidates()) {
    try {
      const { stdout } = await execFileP(
        shell,
        [
          '-ilc',
          `candidate=$(command -v -- "$1") || exit $?; printf '\n${LOGIN_SHELL_EXECUTABLE_MARKER}%s\n' "$candidate"`,
          'pi-harness',
          command
        ],
        { timeout: 8_000, windowsHide: true, env: process.env }
      )
      const candidate = markedShellOutput(stdout, LOGIN_SHELL_EXECUTABLE_MARKER)
      if (candidate && path.isAbsolute(candidate) && (await isExecutableFile(candidate))) {
        return candidate
      }
    } catch {
      // Try another shell.
    }
  }
  return null
}

async function resolveFromSystemLocator(command: string): Promise<string | null> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileP('where.exe', [command], {
        timeout: 5_000,
        windowsHide: true
      })
      for (const line of String(stdout).split(/\r?\n/)) {
        const candidate = line.trim()
        if (candidate && (await isExecutableFile(candidate))) return candidate
      }
    } catch {
      // Fall through to PowerShell.
    }
    try {
      const { stdout } = await execFileP(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Get-Command -Name $env:PI_HARNESS_RESOLVE_COMMAND -ErrorAction Stop).Source'
        ],
        {
          timeout: 8_000,
          windowsHide: true,
          env: { ...process.env, PI_HARNESS_RESOLVE_COMMAND: command }
        }
      )
      const candidate = String(stdout).trim().split(/\r?\n/).find(Boolean)?.trim()
      if (candidate && (await isExecutableFile(candidate))) return candidate
    } catch {
      return null
    }
    return null
  }

  try {
    const { stdout } = await execFileP('which', [command], {
      timeout: 5_000,
      windowsHide: true
    })
    const candidate = String(stdout).trim().split(/\r?\n/).find(Boolean)?.trim()
    return candidate && (await isExecutableFile(candidate)) ? candidate : null
  } catch {
    return null
  }
}

function executableNames(command: string): string[] {
  if (process.platform !== 'win32') return [command]
  return [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command]
}

function loginShellCandidates(): string[] {
  return [...new Set([process.env.SHELL, '/bin/zsh', '/bin/bash'].filter(Boolean) as string[])]
}

function markedShellOutput(output: string | Buffer, marker: string): string | null {
  const lines = String(output).split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (line.startsWith(marker)) return line.slice(marker.length).trim() || null
  }
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? null
}

function splitPath(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function mergePathValues(...values: Array<string | null | undefined>): string {
  return [...new Set(values.flatMap(splitPath))].join(path.delimiter)
}
