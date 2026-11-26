const WINDOWS_ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\)/i

export function parseMessageFileLink(href: string): { path: string; line?: number } | null {
  let target = href.trim()
  if (target.startsWith('//')) return null
  if (/^file:/i.test(target)) {
    try {
      const url = new URL(target)
      const pathname = url.pathname.replace(/^\/(?=[a-z]:\/)/i, '')
      target = `${url.hostname ? `\\\\${url.hostname}` : ''}${pathname}${url.hash}`
    } catch {
      return null
    }
  } else if (
    /^[a-z][a-z\d+.-]*:/i.test(target) &&
    !WINDOWS_ABSOLUTE_PATH.test(target) &&
    !/^[^/:?#]+\.[^/:?#]+:\d+(?::\d+)?(?:#.*)?$/.test(target)
  ) {
    return null
  }

  const [pathname, fragment] = target.split('#', 2)
  const rawPath = pathname.split('?', 1)[0]
  const location = rawPath.match(/:(\d+)(?::\d+)?$/)
  let path: string
  try {
    path = decodeURIComponent(location ? rawPath.slice(0, location.index) : rawPath)
  } catch {
    return null
  }
  if (!path || path.includes('\0') || path.startsWith('//')) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !WINDOWS_ABSOLUTE_PATH.test(path)) return null

  const line = Number(fragment?.match(/^L(\d+)(?:-L?\d+)?$/i)?.[1] ?? location?.[1])
  return { path, line: Number.isSafeInteger(line) && line > 0 ? line : undefined }
}

export function resolveMessageFilePath(path: string, cwd: string | null): string | null {
  if (!path.startsWith('/') && !WINDOWS_ABSOLUTE_PATH.test(path)) {
    if (!cwd) return null
    path = `${cwd.replace(/[\\/]+$/, '')}/${path}`
  }
  const windows = WINDOWS_ABSOLUTE_PATH.test(path)
  const normalized = windows ? path.replace(/\\/g, '/') : path
  const root = normalized.match(/^(?:[a-z]:\/|\/\/[^/]+\/[^/]+\/|\/)/i)?.[0]
  if (!root) return null

  const parts: string[] = []
  for (const part of normalized.slice(root.length).split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  const resolved = root + parts.join('/')
  return windows ? resolved.replace(/\//g, '\\') : resolved
}
