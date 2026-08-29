import type { AgentSessionLike } from '../agent/pi-sdk'

const WRITE_TOOLS = new Set(['write', 'edit'])

export function wrapWorkspaceWriteTools(
  session: AgentSessionLike,
  assertWritable: (target: string) => Promise<string>
): void {
  const tools = session.getAllTools() as Array<Record<string, unknown> & { name: string }>
  for (const tool of tools) {
    if (!WRITE_TOOLS.has(tool.name)) continue
    const key = (['execute', 'handler', 'fn'] as const).find(
      (name) => typeof tool[name] === 'function'
    )
    if (!key) continue
    const original = tool[key] as (args: unknown) => Promise<unknown>
    tool[key] = async (args: unknown) => {
      const target = extractToolPath(args)
      if (typeof target === 'string' && target.trim()) await assertWritable(target)
      return original.call(tool, args)
    }
  }
}

export function extractToolPath(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const record = args as Record<string, unknown>
  for (const key of ['path', 'file', 'file_path', 'filePath', 'target']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}
