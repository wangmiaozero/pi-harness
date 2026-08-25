/** Package source parsing and stable identity rules. */

import path from 'node:path'
import type {
  PiPackageActionResult,
  PiPackageScope,
  PiPackageSourceType
} from '@shared/ipc/api-types'

export interface ResolvedPackageSource {
  type: PiPackageSourceType
  name: string
  installPath: string | null
  managedRoot: string | null
}

const NPM_SOURCE_PATTERN =
  /^npm:((?:@[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127})|(?:[A-Za-z0-9][A-Za-z0-9._-]{0,127}))(?:@([A-Za-z0-9][A-Za-z0-9._~-]{0,127}))?$/

export function parseNpmSource(source: string): { name: string; version: string | null } | null {
  const match = source.match(NPM_SOURCE_PATTERN)
  if (!match?.[1]) return null
  return { name: match[1], version: match[2] ?? null }
}

export function resolvePackageSource(baseDir: string, source: string): ResolvedPackageSource {
  if (source.startsWith('npm:')) {
    const npm = parseNpmSource(source)
    if (!npm) return { type: 'unknown', name: source, installPath: null, managedRoot: null }
    const name = npm.name
    const managedRoot = path.join(baseDir, 'npm', 'node_modules')
    return { type: 'npm', name, installPath: path.join(managedRoot, name), managedRoot }
  }
  const git = parseGitSource(source)
  if (git) {
    const managedRoot = path.join(baseDir, 'git')
    return {
      type: 'git',
      name: path.basename(git.packagePath),
      installPath: path.join(managedRoot, git.host, git.packagePath),
      managedRoot
    }
  }
  if (path.isAbsolute(source) || source.startsWith('./') || source.startsWith('../')) {
    const installPath = path.isAbsolute(source)
      ? path.resolve(source)
      : path.resolve(baseDir, source)
    return { type: 'local', name: path.basename(installPath), installPath, managedRoot: null }
  }
  return { type: 'unknown', name: source, installPath: null, managedRoot: null }
}

export function parseGitSource(source: string): { host: string; packagePath: string } | null {
  const value = source.startsWith('git:') ? source.slice(4) : source
  if (!source.startsWith('git:') && !/^(?:https?|ssh|git):\/\//i.test(value)) return null
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value)) return null
  const scp = value.match(/^git@([^:]+):(.+)$/)
  let host = ''
  let packagePath = ''
  if (scp) {
    host = scp[1] ?? ''
    packagePath = scp[2] ?? ''
  } else if (value.includes('://')) {
    try {
      const url = new URL(value)
      host = url.hostname
      packagePath = url.pathname.replace(/^\/+/, '')
    } catch {
      return null
    }
  } else {
    const slash = value.indexOf('/')
    if (slash < 1) return null
    host = value.slice(0, slash)
    packagePath = value.slice(slash + 1)
  }
  const refAt = packagePath.indexOf('@')
  if (refAt > 0) packagePath = packagePath.slice(0, refAt)
  packagePath = packagePath.replace(/\.git$/i, '').replace(/^\/+/, '')
  packagePath = packagePath.replace(/\\/g, '/')
  const segments = packagePath.split('/')
  if (
    !/^[A-Za-z0-9.-]+$/.test(host) ||
    !packagePath ||
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0')
    )
  ) {
    return null
  }
  return { host, packagePath }
}

export function packageNameFromSource(source: string): string {
  if (!source.startsWith('npm:')) return path.basename(source)
  return parseNpmSource(source)?.name ?? ''
}

export function packageIdentity(source: string, baseDir?: string): string {
  if (source.startsWith('npm:')) return `npm:${packageNameFromSource(source).toLowerCase()}`
  const git = parseGitSource(source)
  if (git) return `git:${git.host.toLowerCase()}/${git.packagePath.toLowerCase()}`
  const localPath = baseDir
    ? path.resolve(baseDir, source)
    : path.isAbsolute(source)
      ? path.resolve(source)
      : source
  return `local:${process.platform === 'win32' ? localPath.toLowerCase() : localPath}`
}

export function packageId(scope: PiPackageScope, source: string, baseDir?: string): string {
  return `${scope}:${packageIdentity(source, baseDir)}`
}

export function resolveInstalledPackagePath(configDir: string, source: string): string | null {
  return resolvePackageSource(configDir, source).installPath
}

export function classifyPackageError(output: string): PiPackageActionResult['errorCode'] {
  return /\bEACCES\b|permission denied|operation not permitted|npm\s+error\s+syscall\s+rename/i.test(
    output
  )
    ? 'EACCES'
    : output.trim()
      ? 'PROCESS_FAILED'
      : null
}
