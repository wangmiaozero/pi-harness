import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { MarketCatalogClient } from './catalog-client'
import { assertZipEntryMode, extractMarketZip } from './extract'
import { MarketInstaller } from './installer'
import { MarketService } from './service'

const cleanup: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  await Promise.all(cleanup.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function temporary(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'market-'))
  cleanup.push(dir)
  return dir
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function zipFiles(files: Array<{ name: string; data: Buffer }>): { zip: Buffer; unpackedSize: number } {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  let unpacked = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const compressed = deflateRawSync(file.data)
    let crc = 0xffffffff
    for (const byte of file.data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
    crc = (~crc) >>> 0
    unpacked += file.data.length
    const local = Buffer.alloc(30 + name.length + compressed.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    compressed.copy(local, 30 + name.length)
    locals.push(local)
    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return { zip: Buffer.concat([...locals, directory, end]), unpackedSize: unpacked }
}

function packed(files: Array<{ name: string; data: Buffer }>) {
  const built = zipFiles(files)
  return {
    ...built,
    sha256: createHash('sha256').update(built.zip).digest('hex'),
    compressedSize: built.zip.length
  }
}

function catalogPackage(
  base: string,
  file: string,
  built: ReturnType<typeof packed>,
  fields: Record<string, unknown>
) {
  return {
    description: 'Official pack',
    author: 'wangmiao',
    license: 'MIT',
    compatible: '>=2.4.0',
    partOf: null,
    parts: [],
    previewUrl: null,
    downloadUrl: `${base}/${file}`,
    sha256: built.sha256,
    compressedSize: built.compressedSize,
    unpackedSize: built.unpackedSize,
    ...fields
  }
}

async function listen(handler: (request: IncomingMessage, response: import('node:http').ServerResponse) => void) {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return `http://127.0.0.1:${address.port}`
}

describe('market zip extraction', () => {
  it('rejects a JavaScript payload', async () => {
    const dir = await temporary()
    const archive = packed([{ name: 'evil.js', data: Buffer.from('process.exit(1)') }])
    await fs.writeFile(path.join(dir, 'evil.zip'), archive.zip)
    await expect(extractMarketZip(path.join(dir, 'evil.zip'), path.join(dir, 'out'), archive.unpackedSize)).rejects.toThrow(
      /Rejected archive file/
    )
  })

  it('rejects a path that escapes the archive', async () => {
    const dir = await temporary()
    const archive = packed([{ name: '../evil.json', data: Buffer.from('{}') }])
    await fs.writeFile(path.join(dir, 'slip.zip'), archive.zip)
    await expect(extractMarketZip(path.join(dir, 'slip.zip'), path.join(dir, 'out'), archive.unpackedSize)).rejects.toThrow(
      /Rejected archive path/
    )
  })

  it('rejects a symlink entry', () => {
    expect(() => assertZipEntryMode(0o120000 << 16)).toThrow(/Rejected archive entry type/)
  })
})

describe('market installer', () => {
  it('installs a theme from the catalog and keeps an unknown directory', async () => {
    const dir = await temporary()
    const built = packed([
      { name: 'package.json', data: Buffer.from(JSON.stringify({ name: '@piharness/theme-deepseek', version: '1.0.0' })) },
      {
        name: 'theme-pack.json',
        data: Buffer.from(
          JSON.stringify({
            formatVersion: 1,
            id: 'deepseek',
            name: 'DeepSeek',
            version: '1.0.0',
            author: 'wangmiao',
            description: 'Official Pi-Harness DeepSeek theme pack',
            license: 'MIT',
            compatiblePiHarness: '>=2.4.0',
            preview: 'preview.png',
            variants: [
              {
                id: 'ropeDeepseek',
                skinId: 'rope-deepseek',
                name: 'DeepSeek',
                appearance: 'dark',
                portrait: true,
                accent: '#3aa0ff',
                frameWidth: 330,
                frameHeight: 384,
                portraitAsset: 'assets/portrait.png'
              }
            ]
          })
        )
      },
      { name: 'preview.png', data: PNG },
      { name: 'assets/portrait.png', data: PNG }
    ])
    let base = ''
    base = await listen((request, response) => {
      if (request.url === '/theme.zip') {
        response.end(built.zip)
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ schemaVersion: 1, packages: [catalogPackage(base, 'theme.zip', built, { name: '@piharness/theme-deepseek', kind: 'theme', version: '1.0.0' })] }))
    })
    const root = path.join(dir, 'user')
    await fs.mkdir(path.join(root, 'themes', 'manual'), { recursive: true })
    await fs.writeFile(path.join(root, 'themes', 'manual', 'keep.txt'), 'keep')
    await fs.writeFile(path.join(root, 'registry.json'), '{"themes":{"old":{"integrity":"sha512-abc"}}}')
    const installer = new MarketInstaller({
      root,
      appVersion: '2.4.0',
      client: new MarketCatalogClient({ appVersion: '2.4.0', catalogUrl: `${base}/catalog.json`, ttlMs: 0 }),
      pets: { install: async () => ({ id: 'unused', version: '1.0.0', updated: false }) }
    })
    const result = await installer.install('@piharness/theme-deepseek')
    expect(result).toMatchObject({ packId: 'deepseek', updated: false })
    await expect(fs.readFile(path.join(root, 'themes', 'manual', 'keep.txt'), 'utf8')).resolves.toBe('keep')
    await expect(fs.readFile(path.join(root, 'registry.json'), 'utf8')).resolves.toContain('sha512-abc')
    const again = await installer.install('@piharness/theme-deepseek')
    expect(again.updated).toBe(true)
    await installer.removeTheme('deepseek')
    await expect(fs.access(path.join(root, 'themes', 'deepseek'))).rejects.toThrow()
  })

  it('refuses a catalog archive whose SHA-256 does not match', async () => {
    const dir = await temporary()
    const built = packed([{ name: 'package.json', data: Buffer.from('{}') }])
    let base = ''
    base = await listen((request, response) => {
      if (request.url === '/theme.zip') {
        response.end(built.zip)
        return
      }
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          packages: [
            catalogPackage(base, 'theme.zip', { ...built, sha256: 'ab'.repeat(32) }, {
              name: '@piharness/theme-deepseek',
              kind: 'theme',
              version: '1.0.0'
            })
          ]
        })
      )
    })
    const root = path.join(dir, 'user')
    const installer = new MarketInstaller({
      root,
      appVersion: '2.4.0',
      client: new MarketCatalogClient({ appVersion: '2.4.0', catalogUrl: `${base}/catalog.json`, ttlMs: 0 }),
      pets: { install: async () => ({ id: 'unused', version: '1.0.0', updated: false }) }
    })
    await expect(installer.install('@piharness/theme-deepseek')).rejects.toThrow(/SHA-256/)
    await expect(fs.access(path.join(root, 'themes', 'deepseek'))).rejects.toThrow()
  })

  it('installs one action pack and keeps it when the base pet is updated', async () => {
    const dir = await temporary()
    const mainFiles = [
      { name: 'package.json', data: Buffer.from(JSON.stringify({ name: '@piharness/pet-bigfish', version: '1.0.2' })) },
      { name: 'pet-pack.json', data: Buffer.from(JSON.stringify({ id: 'bigfish', license: 'MIT', clips: { idle: { dir: 'clips/idle', frames: 1 } } })) },
      { name: 'LICENSE', data: Buffer.from('MIT') },
      { name: 'clips/idle/idle_001.webp', data: PNG }
    ]
    const updatedFiles = mainFiles.map((file) =>
      file.name === 'package.json'
        ? { name: file.name, data: Buffer.from(JSON.stringify({ name: '@piharness/pet-bigfish', version: '1.0.3' })) }
        : file
    )
    const partFiles = [
      { name: 'package.json', data: Buffer.from(JSON.stringify({ name: '@piharness/pet-bigfish-3', version: '1.0.2' })) },
      { name: 'clip-pack.json', data: Buffer.from(JSON.stringify({ formatVersion: 1, clips: { wave: { dir: 'clips/wave', frames: 1 } } })) },
      { name: 'LICENSE', data: Buffer.from('MIT') },
      { name: 'clips/wave/wave_001.webp', data: PNG }
    ]
    const main = packed(mainFiles)
    const updated = packed(updatedFiles)
    const part = packed(partFiles)
    let version = '1.0.2'
    const counts = { main: 0, part: 0 }
    let base = ''
    base = await listen((request, response) => {
      if (request.url === '/main.zip') {
        counts.main += 1
        response.end(version === '1.0.2' ? main.zip : updated.zip)
        return
      }
      if (request.url === '/part.zip') {
        counts.part += 1
        response.end(part.zip)
        return
      }
      const current = version === '1.0.2' ? main : updated
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          packages: [
            catalogPackage(base, 'main.zip', current, { name: '@piharness/pet-bigfish', kind: 'pet', version }),
            catalogPackage(base, 'part.zip', part, {
              name: '@piharness/pet-bigfish-3',
              kind: 'pet',
              version: '1.0.2',
              description: 'BigFish actions: 挥手',
              partOf: '@piharness/pet-bigfish'
            })
          ]
        })
      )
    })
    const petRoot = path.join(dir, 'pets')
    const service = new MarketService({
      userData: path.join(dir, 'data'),
      petRoot,
      appVersion: '2.4.0',
      catalogUrl: `${base}/catalog.json`,
      catalogTtlMs: 0,
      pets: {
        install: async (source) => {
          const manifest = JSON.parse(await fs.readFile(path.join(source.path, 'pet-pack.json'), 'utf8')) as { id: string }
          const destination = path.join(petRoot, manifest.id)
          await fs.rm(destination, { recursive: true, force: true })
          await fs.cp(source.path, destination, { recursive: true })
          return { id: manifest.id, version: '1.1.0', updated: false }
        },
        remove: async (id) => {
          await fs.rm(path.join(petRoot, id), { recursive: true, force: true })
        }
      }
    })
    const result = await service.install('@piharness/pet-bigfish-3')
    expect(result).toMatchObject({ packId: 'bigfish', name: '@piharness/pet-bigfish-3' })
    expect(counts).toEqual({ main: 1, part: 1 })
    const installed = JSON.parse(await fs.readFile(path.join(petRoot, 'bigfish', 'pet-pack.json'), 'utf8')) as {
      clips: Record<string, unknown>
    }
    expect(Object.keys(installed.clips).sort()).toEqual(['idle', 'wave'])
    version = '1.0.3'
    await service.install('@piharness/pet-bigfish')
    const kept = JSON.parse(await fs.readFile(path.join(petRoot, 'bigfish', 'pet-pack.json'), 'utf8')) as {
      clips: Record<string, unknown>
    }
    expect(Object.keys(kept.clips).sort()).toEqual(['idle', 'wave'])
    expect(counts.part).toBe(1)
    await service.uninstall('@piharness/pet-bigfish-3')
    const reduced = JSON.parse(await fs.readFile(path.join(petRoot, 'bigfish', 'pet-pack.json'), 'utf8')) as {
      clips: Record<string, unknown>
    }
    expect(Object.keys(reduced.clips)).toEqual(['idle'])
  })

  it('lists an action pack from one catalog response', async () => {
    const dir = await temporary()
    let requests = 0
    let base = ''
    base = await listen((_request, response) => {
      requests += 1
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          packages: [
            catalogPackage(base, 'main.zip', packed([{ name: 'a', data: Buffer.from('a') }]), {
              name: '@piharness/pet-bigfish',
              kind: 'pet',
              version: '1.0.2',
              description: 'BigFish'
            }),
            catalogPackage(base, 'part.zip', packed([{ name: 'b', data: Buffer.from('b') }]), {
              name: '@piharness/pet-bigfish-2',
              kind: 'pet',
              version: '1.0.2',
              description: 'BigFish actions: 吃饺子',
              partOf: '@piharness/pet-bigfish'
            })
          ]
        })
      )
    })
    const service = new MarketService({
      userData: path.join(dir, 'data'),
      petRoot: path.join(dir, 'pets'),
      appVersion: '2.4.0',
      catalogUrl: `${base}/catalog.json`,
      catalogTtlMs: 0,
      pets: {
        install: async () => ({ id: 'bigfish', version: '1.1.0', updated: false }),
        remove: async () => undefined
      }
    })
    const result = await service.search('bigfish', 'pet', true)
    expect(result.packages.map((item) => item.name)).toEqual(['@piharness/pet-bigfish', '@piharness/pet-bigfish-2'])
    expect(result.packages[1]?.description).toBe('BigFish actions: 吃饺子')
    expect(requests).toBe(1)
  })

  it('cancels a download that has started', async () => {
    const dir = await temporary()
    const built = packed([
      {
        name: 'package.json',
        data: Buffer.from(JSON.stringify({ name: '@piharness/theme-deepseek', version: '1.0.0' }))
      }
    ])
    let started!: () => void
    const zipStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let base = ''
    base = await listen((request, response) => {
      if (request.url === '/theme.zip') {
        started()
        request.on('close', () => response.destroy())
        response.writeHead(200, { 'content-type': 'application/zip' })
        response.write(built.zip.subarray(0, 8))
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          packages: [
            catalogPackage(base, 'theme.zip', built, {
              name: '@piharness/theme-deepseek',
              kind: 'theme',
              version: '1.0.0'
            })
          ]
        })
      )
    })
    const installer = new MarketInstaller({
      root: path.join(dir, 'user'),
      appVersion: '2.4.0',
      client: new MarketCatalogClient({ appVersion: '2.4.0', catalogUrl: `${base}/catalog.json`, ttlMs: 0 }),
      pets: { install: async () => ({ id: 'unused', version: '1.0.0', updated: false }) }
    })
    const pending = installer.install('@piharness/theme-deepseek')
    await zipStarted
    installer.cancel('@piharness/theme-deepseek')
    await expect(pending).rejects.toThrow(/cancelled/)
  })
})
