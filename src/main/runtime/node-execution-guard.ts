import fs from 'node:fs/promises'
import path from 'node:path'
import type { RuntimeProvider } from './active'
import type { ResolvedRuntime } from '@shared/runtime/schema'
import { assessNodeSecurity } from '@shared/runtime/node-security-policy.mjs'
import { EnvironmentError } from '../services/errors'
import { inspectMcpCompatibility } from './mcp-compatibility'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
async function servers(file: string): Promise<Record<string, unknown>> {
  try {
    return record(record(JSON.parse(await fs.readFile(file, 'utf8'))).mcpServers)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)
      return {}
    throw new EnvironmentError(
      'COMMAND_FAILED',
      'MCP configuration could not be checked before starting Node-dependent work'
    )
  }
}
export function assertNodeExecution(runtime: ResolvedRuntime): void {
  const security = assessNodeSecurity(runtime.version)
  if (!runtime.valid || !security.executionAllowed)
    throw new EnvironmentError(
      'NODE_VERSION_TOO_LOW',
      `${!runtime.valid && security.executionAllowed ? runtime.diagnosticMessages.join('; ') || 'The Node runtime could not be verified.' : security.reason} ${security.remediation}`
    )
}

/** Read-only preflight. Native Pi still owns parsing, project trust and connections. */
export async function assertMcpNodeExecution(
  provider: Pick<RuntimeProvider, 'resolve'>,
  agentDir: string,
  cwd: string,
  projectTrusted?: boolean,
  executionNode?: () => Promise<ResolvedRuntime>
): Promise<void> {
  const node = await provider.resolve('node')
  const global = await servers(path.join(agentDir, 'mcp.json'))
  const project = projectTrusted === false ? {} : await servers(path.join(cwd, '.pi/mcp.json'))
  const merged = { ...global }
  for (const [id, raw] of Object.entries(project)) {
    const entry = record(raw)
    if (entry.command === undefined && entry.url === undefined && entry.type === undefined) {
      if (
        global[id] &&
        Object.keys(entry).every((key) => ['enabled', 'exposure', 'toolExposure'].includes(key))
      )
        merged[id] = { ...record(global[id]), ...entry }
    } else merged[id] = entry
  }
  // RPC resolves project trust in the child. Check both possible configurations until then.
  const candidates =
    projectTrusted === undefined ? [global, merged] : [projectTrusted ? merged : global]
  for (const candidate of candidates) {
    const requirements = inspectMcpCompatibility({ mcpServers: candidate }, node, Infinity).filter(
      (entry) => ['node', 'npm', 'npx'].includes(entry.type) && entry.status !== 'external'
    )
    if (requirements.length) {
      assertNodeExecution(node)
      for (const requirement of requirements) {
        if (requirement.type !== 'npm' && requirement.type !== 'npx') continue
        const tool = requirement.type
        const shim = path.join(
          path.dirname(node.executablePath!),
          process.platform === 'win32' ? `${tool}.cmd` : tool
        )
        if (!node[tool] || !(await fs.stat(shim).catch(() => null))?.isFile())
          throw new EnvironmentError(
            'NPM_NOT_FOUND',
            `The selected Node runtime needs its own ${tool} executable for this MCP server; repair or choose the bundled runtime.`
          )
      }
      if (executionNode) assertNodeExecution(await executionNode())
    }
  }
}
