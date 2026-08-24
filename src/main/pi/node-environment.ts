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
export async function nodeToolDirectories(): Promise<string[]> {
  const home = homedir()
  const directories = new Set(
    [
      managedNodeBinDirectory(),
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
      npmBinDirectory(npmUserPrefix()),
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
  const directories = await nodeToolDirectories()
  const managedBin = managedNodeBinDirectory()
  const candidates = directories.map((directory) => ({
    path: directory,
    source: samePath(directory, managedBin) ? ('managed-runtime' as const) : ('candidate' as const)
  }))
  const [node, npm, loginShell] = await Promise.all([
    resolveExecutable('node', { additionalDirectories: candidates }),
    resolveExecutable('npm', { additionalDirectories: candidates }),
    resolveLoginShellPath()
  ])
  const nodeInstalled = validResolution(node)
  const npmInstalled = validResolution(npm)
  const nodeSupported = nodeInstalled && isNodeVersionSupported(node.version)
  const prefix =
    npmInstalled && npm.path
      ? await inspectNpmPrefix(npm.path, { nodePath: node.path })
      : { prefix: null, binDir: null, writable: null }

  return {
    nodeInstalled,
    nodePath: node.path,
    nodeVersion: node.version,
    npmInstalled,
    npmPath: npm.path,
    npmVersion: npm.version,
    nodeSupported,
    minimumNodeVersion: MINIMUM_NODE_VERSION,
    nodeStatus: !nodeInstalled ? 'missing' : nodeSupported ? 'ready' : 'outdated',
    npmStatus: npmInstalled ? 'ready' : 'missing',
    nodeSource: node.source,
    npmSource: npm.source,
    npmPrefix: prefix.prefix,
    npmPrefixWritable: prefix.writable,
    npmBinDir: prefix.binDir,
    resolvedPath: loginShell.path ?? process.env.PATH ?? '',
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
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
