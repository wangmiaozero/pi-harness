/**
 * Path primitives for Agent Workspace.
 *
 * Comparison always goes through samePath() / isPathWithinRoots() — never `===`.
 * Git emits POSIX-style paths even on Windows; Windows itself is case-insensitive.
 */

import { normalize, parse, win32, posix } from 'node:path'

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith('\\\\') || filePath.startsWith('//')
}

export function toNativePath(p: string, platform: NodeJS.Platform = process.platform): string {
  if (!p || platform !== 'win32') return p
  return win32.normalize(p)
}

export function toSlashPath(p: string): string {
  return p.replace(/\\/g, '/')
}

function normalizeForComparison(p: string, platform: NodeJS.Platform): string {
  const resolver = platform === 'win32' ? win32 : posix
  const normalized = resolver.normalize(toNativePath(p, platform))
  const rootLength = resolver.parse(normalized).root.length
  let end = normalized.length
  const separator = platform === 'win32' ? win32.sep : posix.sep
  while (end > rootLength && normalized[end - 1] === separator) end--
  return normalized.slice(0, end)
}

export function normalizePath(p: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32' || isWindowsAbsolutePath(p)) {
    const normalized = win32.normalize(p)
    const parsed = parse(normalized)
    let end = normalized.length
    while (end > parsed.root.length && (normalized[end - 1] === '\\' || normalized[end - 1] === '/')) {
      end--
    }
    return normalized.slice(0, end)
  }
  const normalized = posix.normalize(p)
  const parsed = posix.parse(normalized)
  let end = normalized.length
  while (end > parsed.root.length && normalized[end - 1] === posix.sep) end--
  return normalized.slice(0, end)
}

export function samePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const normalizedA = normalizeForComparison(a, platform)
  const normalizedB = normalizeForComparison(b, platform)
  if (platform === 'win32') {
    return normalizedA.toLowerCase() === normalizedB.toLowerCase()
  }
  return normalizedA === normalizedB
}

/** Host-native normalize used by Main when talking to fs. */
export function toFsPath(p: string): string {
  if (!p) return p
  return process.platform === 'win32' ? win32.normalize(p) : normalize(p)
}
