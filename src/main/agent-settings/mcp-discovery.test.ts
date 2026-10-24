// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { McpDiscoveryService } from './mcp-discovery'
import { FileAccessService } from '../files/file-access-service'
import type { AgentPreferencesService } from './preferences-service'
import { MCP_CATALOG } from '@shared/capabilities/mcp-catalog'
import { mcpSaveSchema } from '@shared/agent-settings/schema'
let home: string, access: FileAccessService
beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-discovery-')))
  access = new FileAccessService()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await fs.rm(home, { recursive: true, force: true })
})
const fixturePreferences = () => ({
  mcp: vi.fn(async () => ({ entries: [], revision: 'a'.repeat(64) })),
  saveMcp: vi.fn(async (input) => input)
})
describe('MCP discovery', () => {
  it('scans JSONC, TOML and OpenCode configs without exposing credentials or executing anything', async () => {
    await fs.mkdir(path.join(home, '.cursor'))
    await fs.mkdir(path.join(home, '.codex'))
    await fs.writeFile(
      path.join(home, '.cursor/mcp.json'),
      `// fixture\n{"mcpServers":{"safe":{"command":"npx","args":["server"],"env":{"KEY":"\${KEY}"}},"private":{"command":"server","args":["--token","fixture-private-token"],"env":{"API_KEY":"fixture-private-env"}},"remote":{"url":"https://example.test/mcp?token=fixture-private-url","headers":{"Authorization":"Bearer fixture-private-header"}}}}`
    )
    await fs.writeFile(
      path.join(home, '.codex/config.toml'),
      '[mcp_servers.toml]\ncommand = "fixture-server"\nargs = ["one", "two"]\n'
    )
    await fs.writeFile(
      path.join(home, '.opencode.json'),
      JSON.stringify({
        mcp: {
          open: {
            type: 'local',
            command: ['fixture-open', '--read-only'],
            environment: { KEY: '${KEY}' }
          }
        }
      })
    )
    const service = new McpDiscoveryService({} as AgentPreferencesService, access, home)
    const result = await service.scan({})
    expect(result.candidates).toHaveLength(5)
    expect(JSON.stringify(result)).not.toContain('fixture-private')
    expect(result.candidates.find((c) => c.template.id === 'safe')).toMatchObject({
      blocked: false,
      template: { enabled: false, env: { KEY: '${KEY}' } }
    })
    expect(result.candidates.find((c) => c.template.id === 'private')).toMatchObject({
      blocked: true,
      template: { args: ['--token', '[redacted]'], env: {} }
    })
    expect(result.candidates.find((c) => c.template.id === 'toml')?.template.args).toEqual([
      'one',
      'two'
    ])
    expect(result.candidates.find((c) => c.template.id === 'open')?.template).toMatchObject({
      command: 'fixture-open',
      args: ['--read-only']
    })
    await expect(service.scan({ root: '/ungranted-fixture' })).rejects.toThrow()
  })
  it('reports malformed, oversized and escaping config files independently', async () => {
    await fs.mkdir(path.join(home, '.cursor'))
    await fs.mkdir(path.join(home, '.codex'))
    await fs.writeFile(path.join(home, '.cursor/mcp.json'), '{invalid')
    await fs.writeFile(path.join(home, '.claude.json'), ' '.repeat(1024 * 1024 + 1))
    await fs.symlink(
      path.join(home, '..', 'outside-fixture'),
      path.join(home, '.codex/config.toml')
    )
    const service = new McpDiscoveryService({} as AgentPreferencesService, access, home)
    const result = await service.scan({})
    expect(result.sources.filter((s) => s.status === 'error')).toHaveLength(2)
    expect(result.candidates).toEqual([])
  })
  it('keeps the included market usable offline and installs only trusted templates after preview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    const prefs = fixturePreferences(),
      service = new McpDiscoveryService(prefs as unknown as AgentPreferencesService, access, home)
    expect((await service.market('Memory')).entries.map((e) => e.template.id)).toEqual(['memory'])
    for (const entry of MCP_CATALOG)
      expect(mcpSaveSchema.safeParse({ ...entry.template, revision: 'a'.repeat(64) }).success).toBe(
        true
      )
    await expect(
      service.install({ catalogId: 'unknown', revision: 'a'.repeat(64) })
    ).rejects.toThrow('Reload')
    await service.install({ catalogId: 'mcp-catalog-memory', revision: 'a'.repeat(64) })
    expect(prefs.saveMcp).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory']
      })
    )
    await expect(
      service.install({
        catalogId: 'mcp-catalog-filesystem',
        revision: 'a'.repeat(64),
        folder: home
      })
    ).rejects.toThrow()
    access.allowRoot(home)
    await service.install({
      catalogId: 'mcp-catalog-filesystem',
      revision: 'a'.repeat(64),
      folder: home
    })
    expect(prefs.saveMcp).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: ['-y', '@modelcontextprotocol/server-filesystem', home] })
    )
  })
  it('previews official npm packages as immutable configurations and excludes unsafe package specifications', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              servers: [
                {
                  server: {
                    name: 'fixture/npm',
                    packages: [
                      {
                        registryType: 'npm',
                        identifier: '@fixture/server',
                        version: '1.2.3',
                        transport: { type: 'stdio' },
                        environmentVariables: [{ name: 'FIXTURE_TOKEN', isRequired: true }]
                      }
                    ]
                  }
                },
                {
                  server: {
                    name: 'fixture/unsafe',
                    packages: [
                      {
                        registryType: 'npm',
                        identifier: 'https://untrusted.test/script',
                        version: 'latest',
                        transport: { type: 'stdio' }
                      }
                    ]
                  }
                },
                {
                  server: {
                    name: 'fixture/argument',
                    packages: [
                      {
                        registryType: 'npm',
                        identifier: 'fixture-server',
                        version: 'latest',
                        transport: { type: 'stdio' },
                        runtimeArguments: [{ value: '--eval=unreviewed' }]
                      }
                    ]
                  }
                }
              ]
            })
          )
      )
    )
    const prefs = fixturePreferences(),
      service = new McpDiscoveryService(prefs as unknown as AgentPreferencesService, access, home)
    const result = await service.market('fixture/')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].template).toMatchObject({
      command: 'npx',
      args: ['-y', '@fixture/server@1.2.3'],
      env: { FIXTURE_TOKEN: '${FIXTURE_TOKEN}' },
      enabled: false
    })
    expect(prefs.saveMcp).not.toHaveBeenCalled()
    await service.install({ catalogId: result.entries[0].capability.id, revision: 'a'.repeat(64) })
    expect(prefs.saveMcp).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['-y', '@fixture/server@1.2.3'], enabled: false })
    )
  })
  it('binds official registry ids to the reviewed endpoint and never fetches a supplied URL', async () => {
    const fetcher = vi.fn(
      async (_url: string | URL) =>
        new Response(
          JSON.stringify({
            servers: [
              {
                server: {
                  name: 'fixture/service',
                  description: 'Fixture',
                  remotes: [{ type: 'streamable-http', url: 'https://fixture.test/mcp' }]
                }
              }
            ],
            metadata: { nextCursor: 'next' }
          })
        )
    )
    vi.stubGlobal('fetch', fetcher)
    const prefs = fixturePreferences(),
      service = new McpDiscoveryService(prefs as unknown as AgentPreferencesService, access, home)
    const result = await service.market('fixture')
    expect(result.nextCursor).toBe('next')
    const id = result.entries[0].capability.id
    await service.install({ catalogId: id, revision: 'a'.repeat(64) })
    expect(prefs.saveMcp).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://fixture.test/mcp', enabled: false })
    )
    expect(String(fetcher.mock.calls[0][0])).toContain('https://registry.modelcontextprotocol.io/')
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
