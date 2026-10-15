import path from 'node:path'
import type { McpRuntimeCompatibility, ResolvedRuntime } from '@shared/runtime/schema'

/** Inspect dependency requirements only. Never copy commands, URLs, headers or env into diagnostics. */
export function inspectMcpCompatibility(
  value: unknown,
  node: ResolvedRuntime
): McpRuntimeCompatibility[] {
  if (!value || typeof value !== 'object') return []
  const servers = (value as { mcpServers?: unknown }).mcpServers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return []
  return Object.entries(servers)
    .slice(0, 200)
    .flatMap(([id, raw]) => {
      if (!raw || typeof raw !== 'object') return []
      const server = raw as { command?: unknown; url?: unknown; enabled?: unknown; env?: unknown }
      if (server.enabled === false) return []
      const command = typeof server.command === 'string' ? server.command : ''
      const name = path.win32
        .basename(path.posix.basename(command))
        .toLowerCase()
        .replace(/\.(exe|cmd|bat)$/, '')
      const type: McpRuntimeCompatibility['type'] = server.url
        ? 'remote'
        : name === 'npx'
          ? 'npx'
          : name === 'npm'
            ? 'npm'
            : name === 'node' || /\.[cm]?[jt]s$/i.test(command)
              ? 'node'
              : /^(python\d*(\.\d+)?|py|uv|uvx)$/.test(name)
                ? 'python'
                : name === 'docker'
                  ? 'docker'
                  : 'native'
      let status: McpRuntimeCompatibility['status'] = ['node', 'npm', 'npx'].includes(type)
        ? node.valid && (type === 'node' || Boolean(node[type as 'npm' | 'npx']))
          ? 'available'
          : 'unavailable'
        : 'external'
      if (
        (type === 'node' &&
          (path.posix.isAbsolute(command) || path.win32.isAbsolute(command)) &&
          command !== node.executablePath) ||
        (server.env &&
          typeof server.env === 'object' &&
          Object.keys(server.env).some((key) => key.toLowerCase() === 'path'))
      )
        status = 'external'
      return [{ id, type, status }]
    })
}
