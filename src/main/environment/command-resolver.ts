import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import type { CommandResolutionSource } from '@shared/ipc/api-types'

const execFileP = promisify(execFile)
const COMMAND_PATTERN = /^[a-zA-Z0-9._-]+$/
const LOGIN_SHELL_PATH_MARKER = '__PI_HARNESS_PATH__'
const LOGIN_SHELL_EXECUTABLE_MARKER = '__PI_HARNESS_EXECUTABLE__'
const LOGIN_SHELL_NODE_MARKER = '__PI_HARNESS_NODE__'
const LOGIN_SHELL_PROBE_TIMEOUT_MS = 8_000
const LOGIN_SHELL_PROBE_MAX_BUFFER_BYTES = 1024 * 1024
// Only manager configuration is copied out of the shell, never its full environment.
const NODE_MANAGER_VARIABLES = [
  'N_PREFIX',
  'NVM_DIR',
  'NVM_BIN',
  'NVM_HOME',
  'NVM_SYMLINK',
  'VOLTA_HOME',
  'FNM_DIR',
  'FNM_MULTISHELL_PATH',
  'MISE_DATA_DIR',
  'MISE_CONFIG_DIR',
  'ASDF_DATA_DIR',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME'
] as const
const NODE_PROBE = `process.stdout.write("\\n${LOGIN_SHELL_NODE_MARKER}"+JSON.stringify({path:process.execPath,version:process.version,env:Object.fromEntries(${JSON.stringify(NODE_MANAGER_VARIABLES)}.filter(k=>process.env[k]).map(k=>[k,process.env[k]]))})+"\\n")`

// Interactive login shells can signal their whole process group with SIGTTIN
// while initializing job control. Keep that group separate from Electron.
function spawnLoginShellProbe(
  shell: string,
  args: string[],
  cwd?: string
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(shell, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdoutChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false

    const kill = (): void => {
      if (!child.pid) return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    const finish = (run: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      run()
    }
    const failForOutputLimit = (): void => {
      kill()
      finish(() => reject(new Error('Login shell probe output exceeded the limit')))
    }
    const timeout = setTimeout(() => {
      kill()
      finish(() => reject(new Error('Login shell probe timed out')))
    }, LOGIN_SHELL_PROBE_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      stdoutBytes += buffer.length
      if (stdoutBytes > LOGIN_SHELL_PROBE_MAX_BUFFER_BYTES) {
        failForOutputLimit()
        return
      }
      stdoutChunks.push(buffer)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (settled) return
      stderrBytes += Buffer.byteLength(chunk)
      if (stderrBytes > LOGIN_SHELL_PROBE_MAX_BUFFER_BYTES) failForOutputLimit()
    })
    child.once('error', (error) => finish(() => reject(error)))
    child.once('close', (code) =>
      finish(() => {
        if (code === 0) resolve({ stdout: Buffer.concat(stdoutChunks).toString('utf8') })
        else reject(new Error(`Login shell probe exited with code ${code ?? 'unknown'}`))
      })
    )
  })
}

export interface LoginShellEnvironment {
  shell: string | null
  path: string | null
  node?: { path: string; version: string }
  env?: NodeJS.ProcessEnv
}

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
  env?: NodeJS.ProcessEnv
  cwd?: string
  requireVersion?: boolean
}

export async function resolveExecutable(
  command: string,
  options: ResolveExecutableOptions = {}
): Promise<ResolvedExecutable> {
  if (!COMMAND_PATTERN.test(command)) throw new Error(`Invalid executable name: ${command}`)
  const inspect = async (file: string, source: CommandResolutionSource) => {
    const result = await resolved(command, file, source, options)
    return !options.requireVersion || result.version ? result : null
  }
  const explicit = options.explicitPath?.trim()
  if (explicit) {
    const explicitPath = await resolveExplicitPath(explicit, command)
    if (explicitPath) {
      const result = await inspect(explicitPath, 'explicit')
      if (result) return result
    }
    if (options.explicitAuthoritative) return missing(command)
  }

  const seen = new Set<string>()
  for (const entry of options.additionalDirectories ?? []) {
    const directory = typeof entry === 'string' ? entry : entry.path
    const source = typeof entry === 'string' ? 'candidate' : (entry.source ?? 'candidate')
    const candidate = await resolveInDirectory(directory, command, seen)
    if (candidate) {
      const result = await inspect(candidate, source)
      if (result) return result
    }
  }

  for (const directory of splitPath(options.env?.PATH ?? process.env.PATH)) {
    const candidate = await resolveInDirectory(directory, command, seen)
    if (candidate) {
      const result = await inspect(candidate, 'process-path')
      if (result) return result
    }
  }

  if (process.platform !== 'win32' && options.loginShell !== false) {
    const shellPath = await resolveFromLoginShell(command)
    if (shellPath) {
      const result = await inspect(shellPath, 'login-shell')
      if (result) return result
    }
  }

  const systemPath = await resolveFromSystemLocator(command)
  if (systemPath) {
    const result = await inspect(systemPath, 'system-locator')
    if (result) return result
  }
  return missing(command)
}

export async function resolveLoginShellPath(
  options: { probeNode?: boolean; cwd?: string; refreshWindowsPath?: boolean } = {}
): Promise<LoginShellEnvironment> {
  const isWindows = process.platform === 'win32'
  if (isWindows && !options.probeNode) {
    return { shell: process.env.ComSpec ?? null, path: process.env.PATH ?? null }
  }
  const shells = isWindows ? ['pwsh.exe', 'powershell.exe'] : loginShellCandidates()
  let fallback: LoginShellEnvironment | null = null
  for (const shell of shells) {
    try {
      // Run node itself: command -v alone only identifies a manager's shim, and
      // misses shell functions/lazy activation. The script contains no user input.
      const script = isWindows
        ? `${options.refreshWindowsPath ? windowsRegistryPathRefreshScript() : ''}Write-Output ("${LOGIN_SHELL_PATH_MARKER}" + $env:PATH); '${NODE_PROBE}' | node; exit 0`
        : `printf '\n${LOGIN_SHELL_PATH_MARKER}%s\n' "$PATH"${options.probeNode ? `; node -e '${NODE_PROBE}'; true` : ''}`
      const { stdout } = isWindows
        ? await execFileP(shell, ['-NoLogo', '-NonInteractive', '-Command', script], {
            timeout: LOGIN_SHELL_PROBE_TIMEOUT_MS,
            windowsHide: true,
            env: process.env,
            cwd: options.cwd ?? homedir()
          })
        : await spawnLoginShellProbe(shell, ['-ilc', script], options.cwd ?? homedir())
      const value = markedShellOutput(stdout, LOGIN_SHELL_PATH_MARKER, false)
      if (value) {
        const snapshot: LoginShellEnvironment = { shell, path: value }
        const probe = markedShellOutput(stdout, LOGIN_SHELL_NODE_MARKER, false)
        if (options.probeNode && probe) {
          try {
            const data = JSON.parse(probe)
            if (
              typeof data.path === 'string' &&
              path.isAbsolute(data.path) &&
              typeof data.version === 'string' &&
              /^v\d+\.\d+\.\d+/.test(data.version) &&
              (await isExecutableFile(data.path))
            ) {
              snapshot.node = { path: data.path, version: data.version }
              snapshot.env = Object.fromEntries(
                NODE_MANAGER_VARIABLES.filter((key) => typeof data.env?.[key] === 'string').map(
                  (key) => [key, data.env[key]]
                )
              )
            }
          } catch {
            // A broken shim must not discard an otherwise valid shell PATH.
          }
        }
        if (snapshot.node || !options.probeNode) return snapshot
        fallback ??= snapshot
      }
    } catch {
      // Try the next supported login shell.
    }
  }
  return fallback ?? { shell: null, path: isWindows ? (process.env.PATH ?? null) : null }
}

function windowsRegistryPathRefreshScript(): string {
  // A running Electron process can retain the PATH from before Node was installed.
  // A new terminal receives the current user and machine PATH from the registry.
  return (
    [
      "$userPath=[Environment]::GetEnvironmentVariable('Path','User')",
      "$machinePath=[Environment]::GetEnvironmentVariable('Path','Machine')",
      'if($userPath){$userPath=[Environment]::ExpandEnvironmentVariables($userPath)}',
      'if($machinePath){$machinePath=[Environment]::ExpandEnvironmentVariables($machinePath)}',
      "$env:PATH=(@($userPath,$machinePath,$env:PATH) | Where-Object { $_ }) -join ';'"
    ].join(';') + ';'
  )
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
  env?: NodeJS.ProcessEnv,
  cwd?: string
): Promise<string | null> {
  const isWindowsShim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)
  const file = isWindowsShim ? (process.env.ComSpec ?? 'cmd.exe') : executable
  const fileArgs = isWindowsShim ? ['/d', '/s', '/c', executable, ...args] : args
  try {
    const { stdout, stderr } = await execFileP(file, fileArgs, {
      timeout: 8_000,
      windowsHide: true,
      cwd,
      env: {
        ...process.env,
        ...env,
        PATH: mergePathValues(env?.PATH, path.dirname(executable), process.env.PATH)
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
  options: ResolveExecutableOptions
): Promise<ResolvedExecutable> {
  return {
    found: true,
    command,
    path: executable,
    version: await readExecutableVersion(executable, options.versionArgs, options.env, options.cwd),
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
      const { stdout } = await spawnLoginShellProbe(
        shell,
        [
          '-ilc',
          `candidate=$(command -v -- "$1") || exit $?; printf '\n${LOGIN_SHELL_EXECUTABLE_MARKER}%s\n' "$candidate"`,
          'pi-harness',
          command
        ]
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

function markedShellOutput(
  output: string | Buffer,
  marker: string,
  allowUnmarked = true
): string | null {
  const lines = String(output).split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (line.startsWith(marker)) return line.slice(marker.length).trim() || null
  }
  if (!allowUnmarked) return null
  return (
    lines
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? null
  )
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
