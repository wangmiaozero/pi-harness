import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import semver from 'semver'
import type { NodeRuntimeInfo } from '@shared/ipc/api-types'
import { managedNodeRoot, npmUserPrefix } from '../services/app-paths'
import {
  resolveExecutable,
  resolveLoginShellPath,
  type ResolvedExecutable
} from '../environment/command-resolver'
import { inspectNpmPrefix, npmBinDirectory } from '../environment/npm-environment'

export const MINIMUM_NODE_VERSION = '22.0.0'

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
    // Optional Node manager is not installed.
  }
}

export function managedNodeBinDirectory(root = managedNodeRoot()): string {
  return process.platform === 'win32' ? root : path.join(root, 'bin')
}

/** Candidate binary directories, including GUI-invisible Node manager paths. */
export async function nodeToolDirectories(
  preferredPath?: string | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  const home = homedir()
  const dataHome = env.XDG_DATA_HOME || path.join(home, '.local', 'share')
  const nvmRoot =
    env.NVM_DIR ||
    (env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, 'nvm') : path.join(home, '.nvm'))
  const fnmRoots = [
    ...new Set(
      [
        env.FNM_DIR,
        path.join(dataHome, 'fnm'),
        path.join(home, 'Library', 'Application Support', 'fnm'),
        env.APPDATA ? path.join(env.APPDATA, 'fnm') : null
      ].filter((value): value is string => Boolean(value))
    )
  ]
  const directories = new Set(
    [
      ...splitSearchPath(preferredPath),
      ...splitSearchPath(env.PATH),
      managedNodeBinDirectory(),
      env.NVM_BIN,
      env.NVM_SYMLINK,
      env.NVM_HOME,
      path.join(env.N_PREFIX || '/usr/local', 'bin'),
      path.join(home, 'n', 'bin'),
      path.join(nvmRoot, 'current', 'bin'),
      path.join(env.VOLTA_HOME || path.join(home, '.volta'), 'bin'),
      path.join(env.ASDF_DATA_DIR || path.join(home, '.asdf'), 'shims'),
      path.join(env.MISE_DATA_DIR || path.join(dataHome, 'mise'), 'shims'),
      path.join(home, '.nvmd', 'bin'),
      env.FNM_MULTISHELL_PATH ? path.join(env.FNM_MULTISHELL_PATH, 'bin') : null,
      ...fnmRoots.map((root) =>
        process.platform === 'win32'
          ? path.join(root, 'aliases', 'default')
          : path.join(root, 'aliases', 'default', 'bin')
      ),
      path.dirname(process.execPath),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      npmBinDirectory(npmUserPrefix())
    ].filter((value): value is string => Boolean(value?.trim()))
  )

  if (process.platform === 'win32') {
    if (env.ProgramFiles) directories.add(path.join(env.ProgramFiles, 'nodejs'))
    if (env.APPDATA) directories.add(path.join(env.APPDATA, 'npm'))
    if (env.LOCALAPPDATA) {
      directories.add(path.join(env.LOCALAPPDATA, 'Programs', 'nodejs'))
    }
  }

  // Stable fallback ordering, independent of filesystem read completion order.
  await addVersionDirectories(directories, path.join(nvmRoot, 'versions', 'node'), 'bin')
  for (const root of fnmRoots) {
    await addVersionDirectories(
      directories,
      path.join(root, 'node-versions'),
      process.platform === 'win32' ? 'installation' : path.join('installation', 'bin')
    )
  }

  return [...directories]
}

export function normalizeNodeVersion(version: string | null | undefined): string | null {
  if (!version) return null
  const match = version.trim().match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)
  if (!match) return null
  return semver.valid(match[1])
}

export function isNodeVersionSupported(version: string | null | undefined): boolean {
  const normalized = normalizeNodeVersion(version)
  return Boolean(normalized && semver.gte(normalized, MINIMUM_NODE_VERSION))
}

export async function detectNodeRuntime(): Promise<NodeRuntimeInfo> {
  // Desktop apps inherit a launch-service PATH that can differ from the user's
  // interactive terminal. Resolve that shell first so version managers and
  // ~/.zshrc PATH changes win over stale Homebrew/system installations.
  const loginShell = await resolveLoginShellPath({ probeNode: true })
  const shellEnv = { ...process.env, ...loginShell.env }
  const directories = await nodeToolDirectories(loginShell.path, shellEnv)
  const managedBin = managedNodeBinDirectory()
  const loginDirectories = new Set(splitSearchPath(loginShell.path).map(pathIdentity))
  const candidates = directories.map((directory) => ({
    path: directory,
    source: samePath(directory, managedBin)
      ? ('managed-runtime' as const)
      : loginDirectories.has(pathIdentity(directory))
        ? ('login-shell' as const)
        : ('candidate' as const)
  }))
  const node: ResolvedExecutable = loginShell.node
    ? { found: true, command: 'node', ...loginShell.node, source: 'login-shell' }
    : await resolveExecutable('node', {
        additionalDirectories: candidates,
        env: { ...shellEnv, PATH: directories.join(path.delimiter) },
        cwd: homedir(),
        loginShell: false,
        requireVersion: true
      })
  // The concrete runtime directory also makes npm's env-node shebang agree
  // with the Node version just detected, even when the shell used a shim.
  const executionDirectories = [
    ...new Set([...(node.path ? [path.dirname(node.path)] : []), ...directories])
  ]
  const executionEnv = { ...shellEnv, PATH: executionDirectories.join(path.delimiter) }
  const toolOptions = {
    additionalDirectories: [
      ...(node.path
        ? [{ path: path.dirname(node.path), source: node.source ?? ('candidate' as const) }]
        : []),
      ...candidates
    ],
    env: executionEnv,
    cwd: homedir(),
    loginShell: false,
    requireVersion: true
  }
  const [npm, pnpm] = await Promise.all([
    resolveExecutable('npm', toolOptions),
    resolveExecutable('pnpm', toolOptions)
  ])
  const nodeInstalled = validResolution(node)
  const npmInstalled = validResolution(npm)
  const pnpmInstalled = validResolution(pnpm)
  const nodeSupported = nodeInstalled && isNodeVersionSupported(node.version)
  const prefix =
    npmInstalled && npm.path
      ? await inspectNpmPrefix(npm.path, { nodePath: node.path, env: executionEnv })
      : { prefix: null, binDir: null, writable: null }

  return {
    nodeInstalled,
    nodePath: node.path,
    nodeVersion: node.version,
    npmInstalled,
    npmPath: npm.path,
    npmVersion: npm.version,
    pnpmInstalled,
    pnpmPath: pnpm.path,
    pnpmVersion: pnpm.version,
    nodeSupported,
    minimumNodeVersion: MINIMUM_NODE_VERSION,
    nodeStatus: !nodeInstalled ? 'missing' : nodeSupported ? 'ready' : 'outdated',
    npmStatus: npmInstalled ? 'ready' : 'missing',
    nodeSource: node.source,
    npmSource: npm.source,
    pnpmSource: pnpm.source,
    npmPrefix: prefix.prefix,
    npmPrefixWritable: prefix.writable,
    npmBinDir: prefix.binDir,
    resolvedPath: executionEnv.PATH,
    ready: Boolean(nodeSupported && npmInstalled)
  }
}

export async function resolveNpmExecutable(): Promise<string> {
  const runtime = await detectNodeRuntime()
  if (!runtime.nodeSupported) throw new Error(`Node.js >= ${MINIMUM_NODE_VERSION} is required`)
  if (!runtime.npmInstalled || !runtime.npmPath) throw new Error('npm not found')
  return runtime.npmPath
}

function validResolution(executable: ResolvedExecutable): boolean {
  return Boolean(executable.found && executable.path && executable.version)
}

function samePath(left: string, right: string): boolean {
  return pathIdentity(left) === pathIdentity(right)
}

function pathIdentity(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function splitSearchPath(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
}
