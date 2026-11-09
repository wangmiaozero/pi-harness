import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { c as createTar } from 'tar'
import { MarketInstaller } from './installer'
import { MarketRegistryClient } from './registry-client'
import { extractMarketTarball } from './extract'

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

describe('market tarball extraction', () => {
  it('rejects a JavaScript payload', async () => {
    const dir = await temporary()
    const source = path.join(dir, 'src')
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'evil.js'), 'process.exit(1)')
    const tarball = path.join(dir, 'evil.tgz')
    await createTar({ gzip: true, file: tarball, cwd: source }, ['evil.js'])
    await expect(extractMarketTarball(tarball, path.join(dir, 'out'))).rejects.toThrow(/Rejected archive file/)
  })

  it('rejects a symlink entry', async () => {
    const dir = await temporary()
    const source = path.join(dir, 'src')
    await fs.mkdir(source)
    await fs.symlink('/etc/passwd', path.join(source, 'link.txt'))
    const tarball = path.join(dir, 'link.tgz')
    await createTar({ gzip: true, file: tarball, cwd: source }, ['link.txt'])
    await expect(extractMarketTarball(tarball, path.join(dir, 'out'))).rejects.toThrow(/Rejected archive entry type/)
  })
})

describe('market installer', () => {
  it('installs a theme from a local registry and rolls the index forward', async () => {
    const dir = await temporary()
    const source = path.join(dir, 'src')
    await fs.mkdir(path.join(source, 'assets'), { recursive: true })
    await fs.writeFile(path.join(source, 'preview.png'), PNG)
    await fs.writeFile(path.join(source, 'assets', 'portrait.png'), PNG)
    await fs.writeFile(
      path.join(source, 'package.json'),
      JSON.stringify({
        name: '@pi-harness/theme-deepseek',
        version: '1.0.0',
        piHarness: { compatible: '>=2.4.0' }
      })
    )
    await fs.writeFile(
      path.join(source, 'theme-pack.json'),
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
    const tarball = path.join(dir, 'theme.tgz')
    await createTar({ gzip: true, file: tarball, cwd: source }, [
      'package.json',
      'theme-pack.json',
      'preview.png',
      'assets/portrait.png'
    ])
    const integrity = `sha512-${await sha512(tarball)}`
    const server = createServer((request, response) => {
      if (request.url?.endsWith('.tgz')) {
        response.setHeader('content-type', 'application/octet-stream')
        createReadStream(tarball).pipe(response)
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          name: '@pi-harness/theme-deepseek',
          description: 'Official Pi-Harness DeepSeek theme pack',
          license: 'MIT',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              version: '1.0.0',
              license: 'MIT',
              piHarness: { compatible: '>=2.4.0' },
              dist: {
                integrity,
                tarball: `${base}/theme.tgz`,
                size: 100,
                unpackedSize: 100
              }
            }
          }
        })
      )
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no port')
    const base = `http://127.0.0.1:${address.port}`
    const root = path.join(dir, 'user')
    const installer = new MarketInstaller({
      root,
      appVersion: '2.4.0',
      client: new MarketRegistryClient(fetch, base),
      pets: { install: async () => ({ id: 'unused', version: '1.0.0', updated: false }) }
    })
    const result = await installer.install('@pi-harness/theme-deepseek')
    expect(result).toMatchObject({ packId: 'deepseek', updated: false })
    await expect(fs.readFile(path.join(root, 'themes', 'deepseek', 'theme-pack.json'), 'utf8')).resolves.toContain(
      '"id":"deepseek"'
    )
    const again = await installer.install('@pi-harness/theme-deepseek')
    expect(again.updated).toBe(true)
    await installer.removeTheme('deepseek')
    await expect(fs.access(path.join(root, 'themes', 'deepseek'))).rejects.toThrow()
  })

  it('merges pet part clips into the main package before install', async () => {
    const dir = await temporary()
    const main = path.join(dir, 'main')
    const part = path.join(dir, 'part')
    await fs.mkdir(path.join(main, 'clips', 'idle'), { recursive: true })
    await fs.mkdir(path.join(part, 'clips', 'wave'), { recursive: true })
    await fs.writeFile(path.join(main, 'clips', 'idle', 'idle_001.webp'), PNG)
    await fs.writeFile(path.join(part, 'clips', 'wave', 'wave_001.webp'), PNG)
    await fs.writeFile(path.join(main, 'LICENSE'), 'MIT')
    await fs.writeFile(path.join(part, 'LICENSE'), 'MIT')
    await fs.writeFile(
      path.join(main, 'package.json'),
      JSON.stringify({
        name: '@pi-harness/pet-bigfish',
        version: '1.0.0',
        piHarness: { compatible: '>=2.4.0', parts: ['@pi-harness/pet-bigfish-2'] }
      })
    )
    await fs.writeFile(
      path.join(part, 'package.json'),
      JSON.stringify({
        name: '@pi-harness/pet-bigfish-2',
        version: '1.0.0',
        piHarness: { compatible: '>=2.4.0', partOf: '@pi-harness/pet-bigfish' }
      })
    )
    await fs.writeFile(path.join(main, 'pet-pack.json'), JSON.stringify({ id: 'bigfish', license: 'MIT' }))
    const mainTarball = path.join(dir, 'main.tgz')
    const partTarball = path.join(dir, 'part.tgz')
    await createTar({ gzip: true, file: mainTarball, cwd: main }, ['package.json', 'pet-pack.json', 'LICENSE', 'clips/idle/idle_001.webp'])
    await createTar({ gzip: true, file: partTarball, cwd: part }, ['package.json', 'LICENSE', 'clips/wave/wave_001.webp'])
    const mainIntegrity = `sha512-${await sha512(mainTarball)}`
    const partIntegrity = `sha512-${await sha512(partTarball)}`
    let base = ''
    const server = createServer((request, response) => {
      const url = request.url ?? ''
      if (url.endsWith('/main.tgz')) {
        response.setHeader('content-type', 'application/octet-stream')
        createReadStream(mainTarball).pipe(response)
        return
      }
      if (url.endsWith('/part.tgz')) {
        response.setHeader('content-type', 'application/octet-stream')
        createReadStream(partTarball).pipe(response)
        return
      }
      const partRequest = url.includes('pet-bigfish-2')
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          name: partRequest ? '@pi-harness/pet-bigfish-2' : '@pi-harness/pet-bigfish',
          description: 'BigFish',
          license: 'MIT',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              version: '1.0.0',
              license: 'MIT',
              piHarness: partRequest
                ? { compatible: '>=2.4.0', partOf: '@pi-harness/pet-bigfish' }
                : { compatible: '>=2.4.0', parts: ['@pi-harness/pet-bigfish-2'] },
              dist: {
                integrity: partRequest ? partIntegrity : mainIntegrity,
                tarball: `${base}/${partRequest ? 'part' : 'main'}.tgz`,
                size: 100,
                unpackedSize: partRequest ? 40 : 60
              }
            }
          }
        })
      )
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no port')
    base = `http://127.0.0.1:${address.port}`
    let clipNames: string[] = []
    const installer = new MarketInstaller({
      root: path.join(dir, 'user'),
      appVersion: '2.4.0',
      client: new MarketRegistryClient(fetch, base),
      pets: {
        install: async (source) => {
          clipNames = await fs.readdir(path.join(source.path, 'clips'))
          return { id: 'bigfish', version: '1.1.0', updated: false }
        }
      }
    })
    const result = await installer.install('@pi-harness/pet-bigfish')
    expect(result).toMatchObject({ packId: 'bigfish', name: '@pi-harness/pet-bigfish' })
    expect(clipNames.sort()).toEqual(['idle', 'wave'])
    await expect(installer.install('@pi-harness/pet-bigfish-2')).rejects.toThrow(
      /Install @pi-harness\/pet-bigfish/
    )
  })
})

function sha512(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
      .on('error', reject)
  })
}
