import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { environmentBackupDir } from '../services/app-paths'
import { atomicWriteText } from '../services/storage'
import { mergeProcessPath, resolveLoginShellPath } from './command-resolver'
import { runCommand } from './command-runner'
import { EnvironmentError } from '../services/errors'

const START_MARKER = '# >>> Pi-Harness environment >>>'
const END_MARKER = '# <<< Pi-Harness environment <<<'

export async function refreshRuntimePath(extraDirectories: string[] = []): Promise<string> {
  const login = await resolveLoginShellPath()
  const merged = mergeProcessPath(...extraDirectories, login.path, process.env.PATH)
  if (!merged) throw new EnvironmentError('PATH_NOT_REFRESHED', 'Could not refresh PATH')
  return merged
}

export async function persistUserPath(
  directories: string[],
  options: { backupRoot?: string; signal?: AbortSignal } = {}
): Promise<void> {
  const unique = uniquePaths(directories)
  if (!unique.length) return
  if (process.platform === 'win32') {
    await persistWindowsUserPath(unique, options.signal)
  } else {
    await persistUnixUserPath(unique, options.backupRoot ?? environmentBackupDir())
  }
  await refreshRuntimePath(unique)
}

async function persistUnixUserPath(directories: string[], backupRoot: string): Promise<void> {
  const profile = unixProfilePath()
  const profileStat = await fs.lstat(profile).catch(() => null)
  const target = profileStat?.isSymbolicLink() ? await fs.realpath(profile) : profile
  const existing = await fs.readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  const pathValue = directories.map(shellSingleQuote).join(':')
  const block = `${START_MARKER}\nexport PATH=${pathValue}:"$PATH"\n${END_MARKER}`
  const matcher = new RegExp(`${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`)
  const next = matcher.test(existing)
    ? existing.replace(matcher, block)
    : `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}\n`
  if (next === existing) return
  if (existing) {
    await fs.mkdir(backupRoot, { recursive: true })
    await fs.copyFile(target, path.join(backupRoot, `${path.basename(profile)}.${Date.now()}.bak`))
  }
  await atomicWriteText(target, next)
}

async function persistWindowsUserPath(directories: string[], signal?: AbortSignal): Promise<void> {
  const powershell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
  const script = [
    "$current=[Environment]::GetEnvironmentVariable('Path','User')",
    "$entries=@($env:PI_HARNESS_PATH_ENTRIES -split ';' | Where-Object { $_ })",
    "$existing=@($current -split ';' | Where-Object { $_ })",
    '$comparison=[StringComparer]::OrdinalIgnoreCase',
    '$merged=New-Object System.Collections.Generic.List[string]',
    'foreach($entry in @($entries+$existing)){if(-not ($merged | Where-Object {$comparison.Equals($_,$entry)})){$merged.Add($entry)}}',
    "[Environment]::SetEnvironmentVariable('Path',($merged -join ';'),'User')"
  ].join(';')
  const result = await runCommand(
    powershell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      signal,
      timeoutMs: 30_000,
      env: { ...process.env, PI_HARNESS_PATH_ENTRIES: directories.join(';') }
    }
  )
  if (result.exitCode !== 0) {
    throw new EnvironmentError('PATH_NOT_REFRESHED', 'Failed to update the Windows user PATH', {
      stderr: result.stderr.slice(0, 1000)
    })
  }
}

function unixProfilePath(): string {
  const shell = path.basename(process.env.SHELL ?? '')
  if (shell === 'zsh') return path.join(homedir(), '.zprofile')
  if (shell === 'bash' && process.platform === 'darwin')
    return path.join(homedir(), '.bash_profile')
  return path.join(homedir(), '.profile')
}

function uniquePaths(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (!value?.trim()) return false
    const resolved = path.resolve(value)
    const identity = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
