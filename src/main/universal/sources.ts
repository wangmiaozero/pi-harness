import path from 'node:path'
import { homedir } from 'node:os'
import fs from 'node:fs/promises'
import { type SourceLocation, type SourceProvider } from '@shared/universal/schema'

export function defaultSources(
  home = homedir(),
  platform = process.platform,
  env = process.env
): SourceLocation[] {
  const join = (...segments: string[]) => path.join(home, ...segments)
  const cursor =
    platform === 'darwin'
      ? join('Library', 'Application Support', 'Cursor', 'User')
      : platform === 'win32'
        ? path.join(env.APPDATA ?? join('AppData', 'Roaming'), 'Cursor', 'User')
        : path.join(env.XDG_CONFIG_HOME ?? join('.config'), 'Cursor', 'User')
  const codex = env.CODEX_HOME ?? join('.codex')
  const claude = env.CLAUDE_CONFIG_DIR ?? join('.claude')
  const definitions: Array<[SourceProvider, string]> = [
    ['claude', path.join(claude, 'projects')],
    ['codex', path.join(codex, 'sessions')],
    ['codex', path.join(codex, 'archived_sessions')],
    ['cursor', env.CURSOR_USER_DIR ?? cursor],
    ['cursor-agent', join('.cursor', 'projects')],
    ['gemini', path.join(env.GEMINI_CLI_HOME ?? join('.gemini'), 'tmp')],
    [
      'opencode',
      env.OPENCODE_HOME ?? path.join(env.XDG_DATA_HOME ?? join('.local', 'share'), 'opencode')
    ],
    [
      'pi',
      path.join(
        env.PI_CODING_AGENT_DIR ?? env.PI_HARNESS_PI_CONFIG_DIR ?? join('.pi', 'agent'),
        'sessions'
      )
    ]
  ]
  return definitions.map(([provider, root]) => ({
    provider,
    root: path.resolve(root),
    custom: false
  }))
}
export async function existingSources(candidates: SourceLocation[]): Promise<SourceLocation[]> {
  const result: SourceLocation[] = []
  for (const source of candidates) {
    try {
      if ((await fs.lstat(source.root)).isDirectory()) {
        const root = await fs.realpath(source.root)
        if (!result.some((s) => s.provider === source.provider && s.root === root))
          result.push({ ...source, root })
      }
    } catch {
      /* Missing tools are normal; discovery never creates their directories. */
    }
  }
  return result
}
export function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}
export async function safeSourceFile(root: string, target: string): Promise<string> {
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('SOURCE_PATH_DENIED')
  if (!contained(root, target)) throw new Error('SOURCE_PATH_DENIED')
  const st = await fs.lstat(target)
  if (st.isSymbolicLink() || !st.isFile()) throw new Error('SOURCE_PATH_DENIED')
  const canonical = await fs.realpath(target)
  if (!contained(await fs.realpath(root), canonical)) throw new Error('SOURCE_PATH_DENIED')
  return canonical
}
export async function walk(root: string, signal?: AbortSignal, maxDepth = 12): Promise<string[]> {
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('SOURCE_PATH_DENIED')
  const result: string[] = []
  async function visit(dir: string, depth: number): Promise<void> {
    signal?.throwIfAborted()
    if (depth > maxDepth) throw new Error('SOURCE_DEPTH_LIMIT')
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (entry.isSymbolicLink()) continue
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(target, depth + 1)
      else if (entry.isFile()) result.push(target)
      if (result.length > 100_000) throw new Error('SOURCE_FILE_LIMIT')
    }
  }
  await visit(root, 0)
  return result.sort()
}
