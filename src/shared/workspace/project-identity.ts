/**
 * Stable internal identity for a project path.
 * Keep the original cwd/projectRoot for display and filesystem operations.
 *
 * Implemented without node:path so the renderer can group sessions safely.
 */
export function projectIdentityKey(projectRoot: string, platform?: NodeJS.Platform): string {
  if (!projectRoot) return projectRoot
  const resolvedPlatform = platform ?? inferPathPlatform(projectRoot)
  if (resolvedPlatform === 'win32') {
    const isUnc = projectRoot.startsWith('\\\\') || projectRoot.startsWith('//')
    let normalized = projectRoot.replace(/\//g, '\\').replace(/\\{2,}/g, '\\')
    if (isUnc) normalized = `\\\\${normalized.replace(/^\\+/, '')}`
    if (!/^[a-zA-Z]:\\$/.test(normalized) && normalized !== '\\\\') {
      normalized = normalized.replace(/\\+$/, '')
    }
    return normalized.toLowerCase()
  }
  let normalized = projectRoot.replace(/\/{2,}/g, '/')
  if (normalized !== '/') normalized = normalized.replace(/\/+$/, '')
  return normalized
}

/**
 * Browser-safe project ownership check for renderer state association.
 * This is not a filesystem security boundary; Main performs canonical checks.
 */
export function isPathWithinProjectRoots(target: string, roots: Iterable<string>): boolean {
  if (!target) return false
  const targetKey = projectIdentityKey(target)
  for (const root of roots) {
    const rootKey = projectIdentityKey(root)
    if (!rootKey) continue
    if (targetKey === rootKey) return true
    const separator = rootKey.includes('\\') ? '\\' : '/'
    const prefix = rootKey.endsWith(separator) ? rootKey : `${rootKey}${separator}`
    if (targetKey.startsWith(prefix)) return true
  }
  return false
}

function inferPathPlatform(projectRoot: string): NodeJS.Platform {
  return /^[a-zA-Z]:[\\/]/.test(projectRoot) ||
    projectRoot.startsWith('\\\\') ||
    projectRoot.startsWith('//')
    ? 'win32'
    : 'linux'
}
