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
  it('keeps only official names and reports an unfinished search', async () => {
    const base = await serve((url) => {
      const from = Number(new URL(url, 'http://127.0.0.1').searchParams.get('from'))
      if (from === 0) {
        return {
          total: 3,
          objects: [
            { package: { name: '@piharness/theme-deepseek', version: '1.0.0', description: 'DeepSeek', publisher: { username: 'piharness' } } },
            { package: { name: '@piharness/pet-bigfish', version: '1.0.0', description: 'BigFish' } },
            { package: { name: '@piharness/pet-bigfish-2', version: '1.0.0', description: 'part' } },
            { package: { name: 'left-pad', version: '1.0.0', description: 'no' } },
            { package: { name: '@piharness/theme-deepseek', version: '1.0.0', description: 'duplicate' } }
          ]
        }
      }
      return { total: 3, objects: [] }
    })
    const client = new MarketRegistryClient(fetch, base)
    const first = await client.search('', 'theme')
    expect(first.packages.map((item) => item.name)).toEqual(['@piharness/theme-deepseek'])
    expect(first.incomplete).toBe(false)
    const cached = await client.search('', 'theme')
    expect(cached.fromCache).toBe(true)
    const pets = await client.search('', 'pet')
    expect(pets.packages.map((item) => item.name)).toEqual([
      '@piharness/pet-bigfish',
      '@piharness/pet-bigfish-2'
    ])
  })

  it('rejects a package outside the official scope before reading versions', async () => {
    const client = new MarketRegistryClient(fetch, 'https://registry.npmjs.org')
    await expect(client.package('left-pad')).rejects.toThrow(/unofficial/)
  })

  it('selects a compatible version and refuses install scripts', async () => {
    const base = await serve(() => ({
      name: '@piharness/theme-deepseek',
      'dist-tags': { latest: '1.2.0' },
      versions: {
        '1.0.0': version(base, '1.0.0', '>=2.4.0', {}),
        '1.2.0': version(base, '1.2.0', '>=9.0.0', {}),
        '1.1.0': version(base, '1.1.0', '>=2.4.0', { postinstall: 'node evil.js' })
      }
    }))
    const client = new MarketRegistryClient(fetch, base)
    const metadata = await client.package('@piharness/theme-deepseek')
    expect(client.selectVersion(metadata, '2.4.0').version).toBe('1.0.0')
  })
})

function version(base: string, name: string, compatible: string, scripts: Record<string, string>) {
  return {
    version: name,
    license: 'MIT',
    scripts,
    piHarness: { compatible },
    dist: {
      integrity: 'sha512-abc',
      tarball: `${base}/@piharness/theme-deepseek/-/theme-deepseek-${name}.tgz`,
      unpackedSize: 10,
      size: 10
    }
  }
}
