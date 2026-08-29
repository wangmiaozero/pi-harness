/** Directory names skipped by workspace search, watchers, and recursive scans. */
export const WORKSPACE_IGNORED_DIRECTORY_NAMES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '.output',
  '.turbo',
  '.cache',
  'out',
  '__pycache__',
  '.venv',
  'venv',
  '.pi'
] as const

const IGNORED = new Set<string>(WORKSPACE_IGNORED_DIRECTORY_NAMES)

export function isIgnoredWorkspaceDirectoryName(name: string): boolean {
  return IGNORED.has(name)
}
