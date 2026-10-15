import path from 'node:path'

/** Child-local environment. Terminal callers explicitly retain the original environment. */
export function buildRuntimeEnvironment(
  base: NodeJS.ProcessEnv,
  nodeExecutable: string | null,
  purpose: 'pi' | 'mcp' | 'extension' | 'npm' | 'terminal',
  platform: string = process.platform
): NodeJS.ProcessEnv {
  const result = { ...base }
  if (purpose === 'terminal') return result
  delete result.ELECTRON_RUN_AS_NODE
  if (!nodeExecutable) return result
  const paths = platform === 'win32' ? path.win32 : path.posix
  const delimiter = platform === 'win32' ? ';' : ':'
  const pathKeys = Object.keys(result).filter((key) => key.toLowerCase() === 'path')
  const original = pathKeys.map((key) => result[key] ?? '').join(delimiter)
  pathKeys.forEach((key) => delete result[key])
  const directories = [paths.dirname(nodeExecutable), ...original.split(delimiter)].filter(Boolean)
  const seen = new Set<string>()
  result.PATH = directories
    .filter((entry) => {
      const identity = platform === 'win32' ? entry.toLowerCase() : entry
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
    .join(delimiter)
  if (platform === 'win32') {
    const extensionKey = Object.keys(result).find((key) => key.toLowerCase() === 'pathext')
    const extensions = result[extensionKey ?? 'PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD'
    if (extensionKey) delete result[extensionKey]
    result.PATHEXT = extensions
  }
  return result
}
