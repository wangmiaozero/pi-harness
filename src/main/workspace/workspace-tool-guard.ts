export function extractToolPath(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const record = args as Record<string, unknown>
  for (const key of ['path', 'file', 'file_path', 'filePath', 'target']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}
import path from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

/** Resolve the path spellings accepted by Native Pi before host authorization. */
export function resolveWorkspaceToolPath(
  value: string,
  cwd: string,
  platform = process.platform,
  home = homedir()
): string {
  const paths = platform === 'win32' ? path.win32 : path.posix
  let normalized = value.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
  if (normalized.startsWith('@')) normalized = normalized.slice(1)
  if (platform === 'win32' && !normalized.includes('\\')) {
    const drive = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(normalized)
    if (drive) normalized = `${drive[1].toUpperCase()}:\\${drive[2]?.replaceAll('/', '\\') ?? ''}`
  }
  if (normalized === '~') normalized = home
  else if (normalized.startsWith('~/') || (platform === 'win32' && normalized.startsWith('~\\'))) {
    normalized = paths.join(home, normalized.slice(2))
  }
  if (normalized.startsWith('file://'))
    normalized = fileURLToPath(normalized, { windows: platform === 'win32' })
  return paths.resolve(cwd, normalized)
}
