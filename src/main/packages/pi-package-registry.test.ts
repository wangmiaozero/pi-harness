import { describe, expect, it, vi } from 'vitest'
import type { PiPackageInfo } from '@shared/ipc/api-types'
import { PiPackageRegistry } from './pi-package-registry'

type TestFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>
type MockFetcher = ReturnType<typeof vi.fn<TestFetcher>>

const manifest = {
  name: 'pi-demo',
  version: '1.4.0',
  description: 'Demo package',
  author: { name: 'Demo Author' },
  license: 'MIT',
  pi: { extensions: ['index.ts'] }
}

function json(value: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function searchPayload(name = 'pi-demo', version = '1.4.0', total = 1) {
  return {
    total,
    objects: [
      {
        package: {
          name,
          version,
          description: 'Demo package',
          keywords: ['pi-package'],
          publisher: { username: 'publisher' },
          date: '2026-01-01T00:00:00.000Z',
          links: { npm: `https://www.npmjs.com/package/${name}` }
        }
      }
    ]
  }
}

function registry(fetcher?: MockFetcher) {
  const mock =
    fetcher ??
    vi.fn<TestFetcher>(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return json(searchPayload())
      if (url.includes('/downloads/')) {
        return json({ downloads: Array.from({ length: 10 }, () => ({ downloads: 10 })) })
      }
      if (url.endsWith('/pi-demo/1.4.0')) return json(manifest)
      if (url.endsWith('/pi-demo')) {
        return json({ 'dist-tags': { latest: '1.4.0' }, versions: { '1.4.0': manifest } })
      }
      return json({}, 404)
    })
  return {
    mock,
    service: new PiPackageRegistry({
      fetch: mock,
      searchUrl: 'https://registry.test/-/v1/search',
      registryUrl: 'https://registry.test',
      downloadsUrl: 'https://downloads.test/downloads/range/last-month'
    })
  }
}

function installed(overrides: Partial<PiPackageInfo> = {}): PiPackageInfo {
  return {
    id: 'global:npm:pi-demo',
    source: 'npm:pi-demo',
    name: 'pi-demo',
    sourceType: 'npm',
    scope: 'global',
    projectRoot: null,
    registered: true,
    registryPath: '/tmp/settings.json',
    version: '1.3.0',
    description: '',
    path: '/tmp/pi-demo',
    installed: true,
    available: true,
    healthy: true,
    health: 'healthy',
    managed: true,
    resources: { extensions: [], skills: [], prompts: [], themes: [], tools: [] },
    resourceItems: [],
    problems: [],
    permissions: [],
    ...overrides
  }
}

describe('PiPackageRegistry', () => {
  it('searches the pi-package keyword plus the server-side query', async () => {
    const { service, mock } = registry()
    await service.searchPackages({ query: 'mcp', pageSize: 50 })
    const url = new URL(String(mock.mock.calls[0]?.[0]))
    expect(url.searchParams.get('text')).toBe('keywords:pi-package mcp')
  })

  it('returns the dynamic registry total', async () => {
    const { service } = registry(vi.fn<TestFetcher>(async () => json({ total: 5329, objects: [] })))
    await expect(service.searchPackages()).resolves.toMatchObject({ total: 5329 })
  })

  it('calculates the registry from offset from page and pageSize', async () => {
    const { service, mock } = registry(
      vi.fn<TestFetcher>(async () => json({ total: 100, objects: [] }))
    )
    await service.searchPackages({ page: 3, pageSize: 50 })
    const url = new URL(String(mock.mock.calls[0]?.[0]))
    expect(url.searchParams.get('from')).toBe('100')
  })

  it('encodes scoped package names in detail URLs', async () => {
    const fetcher = vi.fn<TestFetcher>(async () =>
      json({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: '@pi/demo' } } })
    )
    const { service } = registry(fetcher)
    await service.getPackageDetail('@pi/demo')
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('%40pi%2Fdemo')
  })

  it('reads dist-tags.latest', async () => {
    const { service } = registry()
    await expect(service.getLatestVersion('pi-demo')).resolves.toBe('1.4.0')
  })

  it('exposes the latest pi manifest in package detail', async () => {
    const { service } = registry()
    await expect(service.getPackageDetail('pi-demo')).resolves.toMatchObject({
      piManifest: { extensions: ['index.ts'] }
    })
  })

  it('infers Extension packages', () => {
    expect(registry().service.inferPackageTypes({ extensions: ['index.ts'] })).toEqual([
      'extension'
    ])
  })

  it('infers Skill packages', () => {
    expect(registry().service.inferPackageTypes({ skills: ['skills/demo'] })).toEqual(['skill'])
  })

  it('infers Prompt packages', () => {
    expect(registry().service.inferPackageTypes({ prompts: ['prompt.md'] })).toEqual(['prompt'])
  })

  it('infers Theme packages', () => {
    expect(registry().service.inferPackageTypes({ themes: ['theme.json'] })).toEqual(['theme'])
  })

  it('keeps every declared resource type', () => {
    expect(
      registry().service.inferPackageTypes({ extensions: ['x'], skills: ['s'], themes: ['t'] })
    ).toEqual(['extension', 'skill', 'theme'])
  })

  it('falls back to package when the pi manifest is missing', () => {
    expect(registry().service.inferPackageTypes(undefined)).toEqual(['package'])
  })

  it('degrades a failed detail request without losing the search item', async () => {
    const fetcher = vi.fn<TestFetcher>(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return json(searchPayload())
      if (url.includes('/downloads/')) return json({ downloads: [] })
      return json({}, 500)
    })
    const { service } = registry(fetcher)
    await expect(service.searchPackages()).resolves.toMatchObject({
      items: [{ name: 'pi-demo', detailStatus: 'failed', types: ['package'] }]
    })
  })

  it('uses the list cache inside its TTL', async () => {
    const { service, mock } = registry(
      vi.fn<TestFetcher>(async () => json({ total: 2, objects: [] }))
    )
    await service.searchPackages()
    await service.searchPackages()
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('bypasses the list cache on refresh', async () => {
    const { service, mock } = registry(
      vi.fn<TestFetcher>(async () => json({ total: 2, objects: [] }))
    )
    await service.searchPackages()
    await service.searchPackages({ refresh: true })
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('detects available updates with semver', async () => {
    const { service } = registry()
    await expect(service.checkInstalledPackageUpdate(installed())).resolves.toMatchObject({
      latestVersion: '1.4.0',
      updateAvailable: true,
      state: 'update-available'
    })
  })

  it('reports Registry 429 with retry metadata', async () => {
    const { service } = registry(
      vi.fn<TestFetcher>(async () => json({ error: 'rate limited' }, 429, { 'retry-after': '10' }))
    )
    await expect(service.searchPackages()).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      details: { status: 429, retryAfter: '10' }
    })
  })

  it('reports Registry 500 without returning partial list data', async () => {
    const { service } = registry(
      vi.fn<TestFetcher>(async () => json({ error: 'server error' }, 500))
    )
    await expect(service.searchPackages()).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      details: { status: 500 }
    })
  })
})
