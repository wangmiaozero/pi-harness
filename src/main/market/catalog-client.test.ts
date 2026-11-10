import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MarketCatalogClient } from './catalog-client'

const servers: Server[] = []
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  await Promise.all(cleanup.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function serve(status: number, body: unknown): Promise<string> {
  const server = createServer((_request, response) => {
    response.statusCode = status
    response.setHeader('content-type', 'application/json')
    response.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return `http://127.0.0.1:${address.port}`
}

const pack = {
  name: '@piharness/theme-deepseek',
  kind: 'theme',
  version: '1.0.0',
  description: 'DeepSeek',
  author: 'wangmiao',
  license: 'MIT',
  compatible: '>=2.4.0',
  partOf: null,
  parts: [],
  sha256: 'ab'.repeat(32),
  compressedSize: 10,
  unpackedSize: 20,
  previewUrl: null
}

describe('market catalog client', () => {
  it('rejects a catalog that is not the official source', () => {
    expect(() => new MarketCatalogClient({ appVersion: '2.4.0', catalogUrl: 'https://example.com/catalog.json' })).toThrow(
      /official GitHub catalog/
    )
  })

  it('rejects an unofficial download URL inside a catalog', async () => {
    const base = await serve(200, {
      schemaVersion: 1,
      packages: [{ ...pack, downloadUrl: 'https://example.com/theme.zip' }]
    })
    const client = new MarketCatalogClient({ appVersion: '2.4.0', catalogUrl: `${base}/catalog.json`, ttlMs: 0 })
    await expect(client.search('', 'all', true)).rejects.toThrow(/invalid/)
  })

  it('uses a validated cache when the catalog is offline', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'market-cache-'))
    cleanup.push(dir)
    const base = await serve(200, {
      schemaVersion: 1,
      packages: [{ ...pack, downloadUrl: '' }]
    })
    const downloadUrl = `${base}/theme.zip`
    const cacheFile = path.join(dir, 'catalog-cache.json')
    const first = new MarketCatalogClient({
      appVersion: '2.4.0',
      catalogUrl: `${base}/catalog.json`,
      cacheFile,
      ttlMs: 0,
      fetcher: async () =>
        new Response(JSON.stringify({ schemaVersion: 1, packages: [{ ...pack, downloadUrl }] }), { status: 200 })
    })
    expect((await first.search('', 'theme', true)).packages.map((item) => item.name)).toEqual(['@piharness/theme-deepseek'])
    const second = new MarketCatalogClient({
      appVersion: '2.4.0',
      catalogUrl: `${base}/catalog.json`,
      cacheFile,
      ttlMs: 0,
      fetcher: async () => new Response('no', { status: 500 })
    })
    const cached = await second.search('', 'theme', true)
    expect(cached.offline).toBe(true)
    expect(cached.packages.map((item) => item.name)).toEqual(['@piharness/theme-deepseek'])
  })

  it('returns offline without packages when there is no cache', async () => {
    const base = await serve(404, {})
    const client = new MarketCatalogClient({ appVersion: '2.4.0', catalogUrl: `${base}/catalog.json`, ttlMs: 0 })
    const result = await client.search('', 'all', true)
    expect(result).toMatchObject({ offline: true, packages: [] })
  })
})
