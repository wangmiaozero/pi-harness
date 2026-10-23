// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ResolvedRuntime } from '@shared/runtime/schema'
import { assertMcpNodeExecution } from './node-execution-guard'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})
async function fixture(global: unknown, project: unknown = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-node-policy-'))
  roots.push(root)
  const agent = path.join(root, 'agent')
  const cwd = path.join(root, 'project')
  await fs.mkdir(agent)
  await fs.mkdir(path.join(cwd, '.pi'), { recursive: true })
  await fs.writeFile(path.join(agent, 'mcp.json'), JSON.stringify({ mcpServers: global }))
  await fs.writeFile(path.join(cwd, '.pi/mcp.json'), JSON.stringify({ mcpServers: project }))
  const node: ResolvedRuntime = {
    source: 'custom',
    executablePath: '/unavailable/node',
    version: '24.22.0',
    platform: process.platform,
    arch: process.arch,
    valid: false,
    integrity: 'unmanaged',
    diagnosticMessages: []
  }
  return { agent, cwd, provider: { resolve: async () => node } }
}
it.each(['node', 'npm', 'npx', 'NODE.EXE', 'npm.cmd'])(
  'blocks ordinary %s MCP before inherited PATH can be used',
  async (command) => {
    const f = await fixture({ ordinary: { command } })
    await expect(assertMcpNodeExecution(f.provider, f.agent, f.cwd)).rejects.toThrow(
      'security fixes'
    )
  }
)
it('keeps native, remote and disabled Node servers independent of Node', async () => {
  const f = await fixture({
    native: { command: 'native-fixture' },
    remote: { url: 'http://127.0.0.1:1/mcp' },
    disabled: { command: 'node', enabled: false }
  })
  await expect(assertMcpNodeExecution(f.provider, f.agent, f.cwd)).resolves.toBeUndefined()
})
it('checks all enabled servers beyond the diagnostics display limit', async () => {
  const f = await fixture({
    ...Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [`native${i}`, { command: 'native-fixture' }])
    ),
    last: { command: 'node' }
  })
  await expect(assertMcpNodeExecution(f.provider, f.agent, f.cwd)).rejects.toThrow('security fixes')
})
it('honors a disabled global server in a trusted project and checks both states before RPC trust resolves', async () => {
  const f = await fixture({ ordinary: { command: 'node' } }, { ordinary: { enabled: false } })
  await expect(assertMcpNodeExecution(f.provider, f.agent, f.cwd, true)).resolves.toBeUndefined()
  await expect(assertMcpNodeExecution(f.provider, f.agent, f.cwd, false)).rejects.toThrow()
  await expect(assertMcpNodeExecution(f.provider, f.agent, f.cwd)).rejects.toThrow()
})
it('checks project-only Node servers without treating an untrusted project as enabled', async () => {
  const f = await fixture({}, { ordinary: { command: 'node' } })
  await expect(assertMcpNodeExecution(f.provider, f.agent, f.cwd, false)).resolves.toBeUndefined()
  await expect(assertMcpNodeExecution(f.provider, f.agent, f.cwd, true)).rejects.toThrow()
})
it('checks the actual inherited SDK Node as well as a safe selected Node', async () => {
  const f = await fixture({ ordinary: { command: 'node' } })
  const unsafe = await f.provider.resolve()
  f.provider.resolve = async () => ({ ...unsafe, version: '24.22.1', valid: true })
  await expect(
    assertMcpNodeExecution(f.provider, f.agent, f.cwd, true, async () => unsafe)
  ).rejects.toThrow('security fixes')
})
it('does not fall through to inherited npm/npx when the safe selected Node lacks its toolchain', async () => {
  const f = await fixture({ ordinary: { command: 'npx' } })
  const runtime = await f.provider.resolve()
  f.provider.resolve = async () => ({ ...runtime, version: '24.22.1', valid: true })
  await expect(assertMcpNodeExecution(f.provider, f.agent, f.cwd)).rejects.toThrow('own npx')
})
it('does not require an inherited SDK Node for remote and native MCP', async () => {
  const f = await fixture({
    remote: { url: 'http://127.0.0.1:1/mcp' },
    native: { command: 'native' }
  })
  await expect(
    assertMcpNodeExecution(f.provider, f.agent, f.cwd, true, async () => {
      throw new Error('must not probe')
    })
  ).resolves.toBeUndefined()
})
