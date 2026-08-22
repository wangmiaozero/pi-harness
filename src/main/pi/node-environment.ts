import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import type { NodeRuntimeInfo } from '@shared/ipc/api-types'

const execFileP = promisify(execFile)

async function addVersionDirectories(
  directories: Set<string>,
  root: string,
  suffix: string
): Promise<void> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    entries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
      .forEach((entry) => directories.add(path.join(root, entry.name, suffix)))
  } catch {
    // Node manager is not installed.
  }
}

/** Candidate binary directories, including GUI-invisible Node manager paths. */
export async function nodeToolDirectories(): Promise<string[]> {
  const home = homedir()
  const directories = new Set(
    [
      process.env.NVM_BIN,
      process.env.VOLTA_HOME ? path.join(process.env.VOLTA_HOME, 'bin') : null,
      path.dirname(process.execPath),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      path.join(home, '.volta', 'bin'),
      path.join(home, '.asdf', 'shims'),
      path.join(home, '.local', 'share', 'mise', 'shims'),
      path.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      ...(process.env.PATH?.split(path.delimiter) ?? [])
    ].filter((value): value is string => Boolean(value?.trim()))
  )

  if (process.platform === 'win32') {
    if (process.env.ProgramFiles) directories.add(path.join(process.env.ProgramFiles, 'nodejs'))
    if (process.env.APPDATA) directories.add(path.join(process.env.APPDATA, 'npm'))
    if (process.env.LOCALAPPDATA) {
      directories.add(path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs'))
    }
  }

  await Promise.all([
    addVersionDirectories(directories, path.join(home, '.nvm', 'versions', 'node'), 'bin'),
    addVersionDirectories(
      directories,
      path.join(home, '.local', 'share', 'fnm', 'node-versions'),
      path.join('installation', 'bin')
    ),
    addVersionDirectories(
      directories,
      path.join(home, 'Library', 'Application Support', 'fnm', 'node-versions'),
      path.join('installation', 'bin')
    )
  ])

  return [...directories]
}

function executableNames(tool: 'node' | 'npm'): string[] {
  if (process.platform !== 'win32') return [tool]
  return tool === 'node' ? ['node.exe', 'node'] : ['npm.cmd', 'npm.exe', 'npm.bat', 'npm']
}

async function resolveExecutable(
  tool: 'node' | 'npm',
  directories: string[]
): Promise<string | null> {
  for (const directory of directories) {
    for (const name of executableNames(tool)) {
      const candidate = path.join(directory, name)
      try {
        await fs.access(candidate, fs.constants.F_OK | fs.constants.X_OK)
        return candidate
      } catch {
        // Try the next candidate.
      }
    }
  }

  const locator = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileP(locator, [tool], { timeout: 5000, windowsHide: true })
    return (
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? null
    )
  } catch {
    return null
  }
}

async function readVersion(executable: string): Promise<string | null> {
  const isWindowsShim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)
  const file = isWindowsShim ? (process.env.ComSpec ?? 'cmd.exe') : executable
  const args = isWindowsShim ? ['/d', '/s', '/c', executable, '--version'] : ['--version']
  const executableDir = path.dirname(executable)
  try {
    const { stdout } = await execFileP(file, args, {
      timeout: 5000,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: [executableDir, process.env.PATH].filter(Boolean).join(path.delimiter)
      }
    })
    return stdout.trim().split(/\r?\n/)[0] || null
  } catch {
    return null
  }
}

export async function detectNodeRuntime(): Promise<NodeRuntimeInfo> {
  const directories = await nodeToolDirectories()
  const [nodePath, npmPath] = await Promise.all([
    resolveExecutable('node', directories),
    resolveExecutable('npm', directories)
  ])
  const [nodeVersion, npmVersion] = await Promise.all([
    nodePath ? readVersion(nodePath) : null,
    npmPath ? readVersion(npmPath) : null
  ])

  return {
    nodeInstalled: Boolean(nodePath && nodeVersion),
    nodePath,
    nodeVersion,
    npmInstalled: Boolean(npmPath && npmVersion),
    npmPath,
    npmVersion,
    ready: Boolean(nodePath && nodeVersion && npmPath && npmVersion)
  }
}

export async function resolveNpmExecutable(): Promise<string> {
  const runtime = await detectNodeRuntime()
  if (!runtime.ready || !runtime.npmPath) throw new Error('Node.js or npm not found')
  return runtime.npmPath
}
