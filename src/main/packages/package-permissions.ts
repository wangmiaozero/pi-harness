/** Package filesystem ownership and permission diagnostics/repair. */

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { PiPackagePermission } from '@shared/ipc/api-types'

const execFileAsync = promisify(execFile)

export interface PackagePermissionScope {
  baseDir: string
}

export async function inspectPackagePermission(target: string): Promise<PiPackagePermission> {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
  let stat: Awaited<ReturnType<typeof fs.lstat>> | null = null
  let statError: NodeJS.ErrnoException | null = null
  try {
    stat = await fs.lstat(target)
  } catch (error) {
    statError = error as NodeJS.ErrnoException
  }
  if (!stat) {
    const inaccessible = statError?.code !== 'ENOENT' && statError !== null
    return {
      path: target,
      exists: inaccessible,
      readable: false,
      writable: false,
      executable: false,
      ownerUid: null,
      currentUid,
      ownerMatches: null,
      problem: inaccessible
        ? `${statError?.code ?? 'FILE_SYSTEM_ERROR'}: ${statError?.message ?? 'Cannot inspect path'}`
        : null
    }
  }
  const [readable, writable, executable] = await Promise.all([
    hasAccess(target, fs.constants.R_OK),
    hasAccess(target, fs.constants.W_OK),
    hasAccess(target, fs.constants.X_OK)
  ])
  const ownerUid = typeof stat.uid === 'number' ? stat.uid : null
  const ownerMatches = ownerUid === null || currentUid === null ? null : ownerUid === currentUid
  const problem =
    ownerMatches === false
      ? `Owner uid ${ownerUid} differs from current uid ${currentUid}`
      : !readable || !writable || (stat.isDirectory() && !executable)
        ? 'Current user lacks read/write/execute permission'
        : null
  return {
    path: target,
    exists: true,
    readable,
    writable,
    executable,
    ownerUid,
    currentUid,
    ownerMatches,
    problem
  }
}

export async function findNestedPermissionProblem(
  root: string
): Promise<PiPackagePermission | null> {
  let visited = 0
  const maxEntries = 4000
  async function scan(current: string, depth: number): Promise<PiPackagePermission | null> {
    if (depth > 6 || visited++ > maxEntries) return null
    const permission = await inspectPackagePermission(current)
    if (permission.exists && permission.problem) return permission
    const stat = await lstatOrNull(current)
    if (!stat?.isDirectory() || stat.isSymbolicLink()) return null
    for (const entry of await readdirSafe(current)) {
      const found = await scan(path.join(current, entry.name), depth + 1)
      if (found) return found
    }
    return null
  }
  return scan(root, 0)
}

export async function repairOwnedPermissions(root: string): Promise<void> {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
  if (currentUid === null) return
  async function repair(current: string, depth: number): Promise<void> {
    if (depth > 8) return
    const stat = await lstatOrNull(current)
    if (!stat || stat.isSymbolicLink()) return
    if (stat.uid === currentUid) {
      const ownerReadWrite = 0o600
      const ownerExecute = stat.isDirectory() || (stat.mode & 0o100) !== 0 ? 0o100 : 0
      await fs.chmod(current, stat.mode | ownerReadWrite | ownerExecute).catch(() => undefined)
    }
    if (!stat.isDirectory()) return
    for (const entry of await readdirSafe(current)) {
      await repair(path.join(current, entry.name), depth + 1)
    }
  }
  await repair(root, 0)
}

export async function repairSingleOwnedPermission(target: string): Promise<void> {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
  if (currentUid === null) return
  const stat = await lstatOrNull(target)
  if (!stat || stat.isSymbolicLink() || stat.uid !== currentUid) return
  const ownerExecute = stat.isDirectory() || (stat.mode & 0o100) !== 0 ? 0o100 : 0
  await fs.chmod(target, stat.mode | 0o600 | ownerExecute).catch(() => undefined)
}

export async function repairForeignOwnershipWithMacAuthorization(
  scopes: PackagePermissionScope[],
  permissions: PiPackagePermission[]
): Promise<void> {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  const gid = typeof process.getgid === 'function' ? process.getgid() : null
  if (uid === null || gid === null) return
  const commands: string[] = []
  for (const scope of scopes) {
    if (
      permissions.some(
        (permission) =>
          permission.path === scope.baseDir &&
          permission.exists &&
          permission.ownerMatches === false
      )
    ) {
      commands.push(
        `/usr/sbin/chown ${uid}:${gid} ${shellQuote(scope.baseDir)}`,
        `/bin/chmod u+rwx ${shellQuote(scope.baseDir)}`
      )
    }
    for (const root of [path.join(scope.baseDir, 'npm'), path.join(scope.baseDir, 'git')]) {
      const rootStat = await lstatOrNull(root)
      if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) continue
      const hasForeignOwner = permissions.some(
        (permission) =>
          permission.exists &&
          permission.ownerMatches === false &&
          (permission.path === root || permission.path.startsWith(root + path.sep))
      )
      if (!hasForeignOwner) continue
      commands.push(
        `/usr/sbin/chown -R ${uid}:${gid} ${shellQuote(root)}`,
        `/bin/chmod -R u+rwX ${shellQuote(root)}`
      )
    }
  }
  if (!commands.length) return
  const command = commands.join(' && ')
  const appleScriptString = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  await execFileAsync('/usr/bin/osascript', [
    '-e',
    `do shell script "${appleScriptString}" with administrator privileges`
  ])
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

async function hasAccess(target: string, mode: number): Promise<boolean> {
  try {
    await fs.access(target, mode)
    return true
  } catch {
    return false
  }
}

async function readdirSafe(target: string) {
  try {
    return await fs.readdir(target, { withFileTypes: true })
  } catch {
    return []
  }
}

async function lstatOrNull(target: string) {
  try {
    return await fs.lstat(target)
  } catch {
    return null
  }
}
