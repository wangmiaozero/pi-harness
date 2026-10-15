import { describe, expect, it } from 'vitest'
import { inspectMcpCompatibility } from './mcp-compatibility'
import type { ResolvedRuntime } from '@shared/runtime/schema'
const node: ResolvedRuntime = {
  source: 'bundled',
  executablePath: '/bundled/node',
  version: '24.22.0',
  platform: 'linux',
  arch: 'x64',
  valid: true,
  integrity: 'verified',
  diagnosticMessages: [],
  npm: { cliPath: '/npm-cli.js', version: '11.19.1' },
  npx: { cliPath: '/npx-cli.js', version: '11.19.1' }
}
describe('MCP dependency diagnostics', () => {
  it('keeps native, Python, Docker and remote requirements independent of Node and excludes secrets', () => {
    const result = inspectMcpCompatibility(
      {
        mcpServers: {
          native: { command: '/bin/native' },
          node: { command: 'node', env: { API_KEY: 'test-secret-value' } },
          package: { command: 'npx' },
          python: { command: 'uvx' },
          docker: { command: 'docker' },
          remote: {
            url: 'https://fixture.invalid/?token=test-secret-value',
            headers: { Authorization: 'test-secret-value' }
          }
        }
      },
      { ...node, valid: false }
    )
    expect(result.find((entry) => entry.id === 'node')?.status).toBe('unavailable')
    for (const id of ['native', 'python', 'docker', 'remote'])
      expect(result.find((entry) => entry.id === id)?.status).toBe('external')
    expect(JSON.stringify(result)).not.toContain('test-secret-value')
    expect(JSON.stringify(result)).not.toContain('https:')
  })
  it('flags an explicit foreign Node or PATH override instead of asserting compatibility', () => {
    expect(
      inspectMcpCompatibility(
        {
          mcpServers: {
            foreign: { command: '/other/node' },
            override: { command: 'node', env: { Path: '/other/bin' } },
            local: { command: 'npx' }
          }
        },
        node
      )
    ).toEqual([
      { id: 'foreign', type: 'node', status: 'external' },
      { id: 'override', type: 'node', status: 'external' },
      { id: 'local', type: 'npx', status: 'available' }
    ])
  })
})
