import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it, afterEach } from 'vitest'
import { MarketRegistryClient } from './registry-client'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function serve(handler: (url: string) => unknown): Promise<string> {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(handler(request.url ?? '')))
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return `http://127.0.0.1:${address.port}`
}

describe('market registry client', () => {
  it('lists official packages from the scope without the search index', async () => {
    const base = await serve((url) => {
      const parsed = new URL(url, 'http://127.0.0.1')
      if (parsed.pathname !== '/-/org/piharness/package') return {}
      return {
        '@piharness/theme-deepseek': 'read',
        '@piharness/pet-bigfish': 'read',
        '@piharness/pet-bigfish-2': 'read',
        'left-pad': 'read',
        '@other/theme-deepseek': 'read'
      }
    })
    const client = new MarketRegistryClient(fetch, base)
    const first = await client.search('', 'theme')
    expect(first.packages.map((item) => item.name)).toEqual(['@piharness/theme-deepseek'])
    expect(first.incomplete).toBe(false)
    const cached = await client.search('', 'theme')
    expect(cached.fromCache).toBe(true)
    const pets = await client.search('bigfish', 'pet')
    expect(pets.packages.map((item) => item.name)).toEqual([
      '@piharness/pet-bigfish',
      '@piharness/pet-bigfish-2'
    ])
  })

  it('rejects a package outside the official scope before reading versions', async () => {
    const client = new MarketRegistryClient(fetch, 'https://registry.npmjs.org')
    await expect(client.package('left-pad')).rejects.toThrow(/unofficial/)
  })

  it('rejects a package maintained by anyone except piharness', async () => {
    const base = await serve(() => ({
      name: '@piharness/theme-deepseek',
      maintainers: [{ name: 'piharness' }, { name: 'other' }],
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': version(base, '1.0.0', '>=2.4.0', {})
      }
    }))
    const client = new MarketRegistryClient(fetch, base)
    await expect(client.package('@piharness/theme-deepseek')).rejects.toThrow(/piharness/)
  })

  it('selects a compatible version and refuses install scripts', async () => {
    const base = await serve(() => ({
      name: '@piharness/theme-deepseek',
      maintainers: [{ name: 'piharness' }],
      'dist-tags': { latest: '1.2.0' },
      versions: {
        '1.0.0': version(base, '1.0.0', '>=2.4.0', {}),
        '1.2.0': version(base, '1.2.0', '>=9.0.0', {}, 'other'),
        '1.1.0': version(base, '1.1.0', '>=2.4.0', { postinstall: 'node evil.js' })
      }
    }))
    const client = new MarketRegistryClient(fetch, base)
    const metadata = await client.package('@piharness/theme-deepseek')
    expect(client.selectVersion(metadata, '2.4.0').version).toBe('1.0.0')
  })
})

function version(
  base: string,
  name: string,
  compatible: string,
  scripts: Record<string, string>,
  publisher = 'piharness'
) {
  return {
    version: name,
    license: 'MIT',
    scripts,
    _npmUser: { name: publisher },
    piHarness: { compatible },
    dist: {
      integrity: 'sha512-abc',
      tarball: `${base}/@piharness/theme-deepseek/-/theme-deepseek-${name}.tgz`,
      unpackedSize: 10,
      size: 10
    }
  }
}
