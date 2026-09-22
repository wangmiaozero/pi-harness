/**
 * Resolve a dropped File / path payload to a filesystem path.
 *
 * Electron exposes `webUtils.getPathForFile`. WKWebView `File` has no path;
 * Tauri native drag-drop supplies absolute paths that we match by basename.
 */

const NATIVE_DROP_TTL_MS = 2500

let lastNativeDrop: { paths: string[]; at: number } | null = null

export function rememberNativeDropPaths(paths: string[], at = Date.now()): void {
  lastNativeDrop = { paths: paths.filter((path) => path.length > 0), at }
}

export function resetNativeDropPaths(): void {
  lastNativeDrop = null
}

export function recentNativeDropPaths(now = Date.now()): string[] {
  if (!lastNativeDrop || now - lastNativeDrop.at > NATIVE_DROP_TTL_MS) return []
  return lastNativeDrop.paths
}

export function looksLikeFsPath(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('/') || trimmed.startsWith('\\\\')) return true
  return /^[a-zA-Z]:[\\/]/.test(trimmed)
}

export function extractDroppedPath(file: unknown): string | null {
  if (typeof file === 'string') {
    const trimmed = file.trim()
    return trimmed ? trimmed : null
  }
  if (!file || typeof file !== 'object') return null
  const record = file as { path?: unknown; name?: unknown }
  if (typeof record.path === 'string' && record.path.trim()) return record.path.trim()
  if (typeof record.name === 'string' && looksLikeFsPath(record.name)) return record.name.trim()
  return null
}

export function matchDroppedPathByName(name: string, candidates: string[]): string | null {
  const needle = name.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!needle) return null
  const base = needle.split('/').pop() ?? needle
  const hits = candidates.filter((candidate) => {
    const normalized = candidate.replace(/\\/g, '/').replace(/\/+$/, '')
    const candidateBase = normalized.split('/').pop() ?? normalized
    return normalized === needle || candidateBase === base
  })
  return hits[0] ?? null
}

export function resolveDroppedFilePath(file: unknown, now = Date.now()): string | null {
  const extracted = extractDroppedPath(file)
  if (extracted) return extracted
  const name =
    typeof file === 'string'
      ? file
      : file && typeof file === 'object' && typeof (file as { name?: unknown }).name === 'string'
        ? (file as { name: string }).name
        : ''
  return matchDroppedPathByName(name, recentNativeDropPaths(now))
}
