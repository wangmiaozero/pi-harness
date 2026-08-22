import path from 'node:path'
import { isWindowsAbsolutePath } from './paths'

/**
 * Lexical containment check. Accepts either canonical form on both sides:
 * re-resolves through path.win32/path.posix and case-folds on Windows, so
 * separator style and drive-letter case never decide the answer.
 *
 * This is the single allowed-roots implementation. Do not reimplement with
 * startsWith(root).
 */
export function isPathWithinRoots(target: string, roots: Iterable<string>): boolean {
  for (const root of roots) {
    if (isPathWithin(target, root)) return true
  }
  return false
}

export function isPathWithin(target: string, root: string): boolean {
  const useWindowsRules = isWindowsAbsolutePath(target) || isWindowsAbsolutePath(root)
  const resolver = useWindowsRules ? path.win32 : path.posix
  const sep = useWindowsRules ? '\\' : '/'
  const normalized = resolver.resolve(target)
  const normalizedRoot = resolver.resolve(root)
  const comparable = useWindowsRules ? normalized.toLowerCase() : normalized
  const comparableRoot = useWindowsRules ? normalizedRoot.toLowerCase() : normalizedRoot
  const rootWithSep = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep
  return comparable === comparableRoot || comparable.startsWith(rootWithSep)
}
