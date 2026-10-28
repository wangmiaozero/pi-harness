import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PetPackError,
  PetPackRegistry,
  isImageBuffer,
  isWebpBuffer,
  validatePackResources
} from './registry'
import { loadPetPack } from './pack'
import { createPackDir, junkBytes, pngImage, webpFrame, zipFromPackDir, buildZip } from './test-fixtures'

let tmpRoot: string
let bundledRoot: string
let userRoot: string

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petpack-test-'))
  bundledRoot = path.join(tmpRoot, 'bundled')
  userRoot = path.join(tmpRoot, 'user-packs')
  await fs.mkdir(bundledRoot, { recursive: true })
  await fs.mkdir(userRoot, { recursive: true })
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

function makeRegistry(): PetPackRegistry {
  return new PetPackRegistry(bundledRoot, userRoot)
}

describe('isWebpBuffer / isImageBuffer', () => {
  it('recognizes real WebP bytes and rejects junk', () => {
    expect(isWebpBuffer(webpFrame())).toBe(true)
    expect(isWebpBuffer(junkBytes())).toBe(false)
    expect(isWebpBuffer(pngImage())).toBe(false)
  })

  it('recognizes PNG/WebP/JPEG as preview images', () => {
    expect(isImageBuffer(pngImage())).toBe(true)
    expect(isImageBuffer(webpFrame())).toBe(true)
    expect(isImageBuffer(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(8)]))).toBe(true)
    expect(isImageBuffer(junkBytes())).toBe(false)
  })
})

describe('validatePackResources', () => {
  it('accepts a fully valid pack', async () => {
    const fixture = await createPackDir(tmpRoot, { id: 'good', useClipsLayout: false })
    const pack = await loadPetPack(fixture.root)
    await expect(validatePackResources(pack)).resolves.toBeUndefined()
  })

  it('rejects a pack with no idle clip and no defaultAnimation', async () => {
    const fixture = await createPackDir(tmpRoot, {
      id: 'noidle',
      useClipsLayout: false,
      manifestOverride: {
        formatVersion: 1,
        id: 'noidle',
        name: 'x',
        nameEn: 'x',
        author: 'a',
        version: '1.0.0',
        license: 'MIT',
        baseWidth: 10,
        baseHeight: 10,
        fps: 24,
        clips: { hop: { dir: 'hop', frames: 1, loop: true } }
      }
    })
    await fs.rm(path.join(fixture.root, 'hop'), { recursive: true, force: true })
    await fs.mkdir(path.join(fixture.root, 'hop'))
    await fs.writeFile(path.join(fixture.root, 'hop', 'hop_001.webp'), webpFrame())
    const pack = await loadPetPack(fixture.root)
    await expect(validatePackResources(pack)).rejects.toThrow(PetPackError)
  })

  it('rejects a frame that exists by count but not by convention', async () => {
    // loadPetPack only counts .webp files, so a misnamed frame passes the
    // cheap check — validatePackResources must catch the convention gap.
    const fixture = await createPackDir(tmpRoot, { id: 'gap', frames: 2 })
    await fs.rm(path.join(fixture.root, 'clips/idle/idle_002.webp'))
    await fs.writeFile(path.join(fixture.root, 'clips/idle/misnamed.webp'), webpFrame())
    const pack = await loadPetPack(fixture.root)
    await expect(validatePackResources(pack)).rejects.toThrow(/idle_002\.webp" is missing/)
  })

  it('rejects a corrupt (non-WebP) frame', async () => {
    const fixture = await createPackDir(tmpRoot, { id: 'corrupt', corruptFrames: true })
    const pack = await loadPetPack(fixture.root)
    await expect(validatePackResources(pack)).rejects.toThrow(/not a valid WebP/)
  })

  it('rejects a missing or invalid preview image', async () => {
    const fixture = await createPackDir(tmpRoot, { id: 'nopreview', preview: true })
    await fs.rm(path.join(fixture.root, 'preview.png'))
    const pack = await loadPetPack(fixture.root)
    await expect(validatePackResources(pack)).rejects.toThrow(/preview file "preview.png" is missing/)

    const bad = await createPackDir(tmpRoot, { id: 'badpreview', preview: junkBytes() })
    const pack2 = await loadPetPack(bad.root)
    await expect(validatePackResources(pack2)).rejects.toThrow(/not a valid PNG\/JPEG\/WebP/)
  })
})

describe('PetPackRegistry.list / detail', () => {
  it('lists bundled packs with bundled=true and user packs with bundled=false', async () => {
    await createPackDir(bundledRoot, { id: 'bigfish', useClipsLayout: false })
    await createPackDir(userRoot, { id: 'custom', useClipsLayout: false })
    const packs = await makeRegistry().list()
    expect(packs.map((pack) => [pack.id, pack.bundled])).toEqual([
      ['bigfish', true],
      ['custom', false]
    ])
  })

  it('marks a broken user pack as incompatible instead of hiding it', async () => {
    const fixture = await createPackDir(userRoot, { id: 'broken', corruptFrames: true })
    // Frames load fine (count matches); make it break at manifest level.
    await fs.writeFile(path.join(fixture.root, 'pet-pack.json'), '{"id":"broken","name":"Broken"}')
    const packs = await makeRegistry().list()
    const broken = packs.find((pack) => pack.id === 'broken')
    expect(broken?.compatible).toBe(false)
    expect(broken?.resourceError).toBeTruthy()
  })

  it('skips hidden staging directories', async () => {
    await fs.mkdir(path.join(userRoot, '.staging'), { recursive: true })
    await fs.writeFile(path.join(userRoot, '.staging', 'pet-pack.json'), '{}')
    const packs = await makeRegistry().list()
    expect(packs).toHaveLength(0)
  })

  it('detail returns clips and license files for a valid pack', async () => {
    await createPackDir(userRoot, { id: 'detailpack', useClipsLayout: false })
    const detail = await makeRegistry().detail('detailpack')
    expect(detail).not.toBeNull()
    expect(detail?.licenseFiles).toContain('LICENSE')
    expect(Object.keys(detail?.clips ?? {})).toContain('idle')
  })
})

describe('PetPackRegistry.install', () => {
  it('installs a valid ZIP into the user pack root', async () => {
    const fixture = await createPackDir(tmpRoot, { id: 'zipimport', useClipsLayout: false, preview: true })
    const zip = await zipFromPackDir(fixture.root)
    const registry = makeRegistry()
    const result = await registry.install({ kind: 'zip', data: zip })
    expect(result).toMatchObject({ id: 'zipimport', updated: false, version: '1.0.0' })
    const packs = await registry.list()
    expect(packs.find((pack) => pack.id === 'zipimport')?.bundled).toBe(false)
    await expect(fs.access(path.join(userRoot, 'zipimport', 'pet-pack.json'))).resolves.toBeUndefined()
  })

  it('installs a valid local directory', async () => {
    const fixture = await createPackDir(tmpRoot, { id: 'dirimport', useClipsLayout: false })
    const result = await makeRegistry().install({ kind: 'directory', path: fixture.root })
    expect(result.id).toBe('dirimport')
    await expect(fs.access(path.join(userRoot, 'dirimport', 'pet-pack.json'))).resolves.toBeUndefined()
  })

  it('rejects ZIPs without pet-pack.json at the root', async () => {
    const zip = buildZip([{ name: 'readme.txt', data: 'no manifest' }])
    await expect(makeRegistry().install({ kind: 'zip', data: zip })).rejects.toThrow(/missing pet-pack\.json/)
  })

  it('rejects ZIP Slip entries', async () => {
    const fixture = await createPackDir(tmpRoot, { id: 'slip', useClipsLayout: false })
    const zip = buildZip([
      { name: 'pet-pack.json', data: fixture.manifestJson },
      { name: '../escape.txt', data: 'x' }
    ])
    await expect(makeRegistry().install({ kind: 'zip', data: zip })).rejects.toThrow(/Unsafe ZIP entry path/)
    // Nothing left behind.
    expect(await fs.readdir(userRoot)).toEqual([])
  })

  it('rejects symlink entries inside ZIPs', async () => {
    const fixture = await createPackDir(tmpRoot, { id: 'ziplink', useClipsLayout: false })
    const zip = buildZip([
      { name: 'pet-pack.json', data: fixture.manifestJson },
      { name: 'link', data: '/etc/passwd', externalAttributes: (0o120777 << 16) >>> 0 }
    ])
    await expect(makeRegistry().install({ kind: 'zip', data: zip })).rejects.toThrow(/symlink or special file/)
  })

  it('rejects directory imports containing symlinks', async () => {
    const fixture = await createPackDir(tmpRoot, { id: 'dirlink', useClipsLayout: false })
    await fs.symlink('/etc/passwd', path.join(fixture.root, 'evil'))
    await expect(makeRegistry().install({ kind: 'directory', path: fixture.root })).rejects.toThrow(
      /symbolic links/
    )
    expect(await fs.readdir(userRoot)).toEqual([])
  })

  it('rejects a ZIP whose pack is invalid (missing frames), leaving nothing installed', async () => {
    const fixture = await createPackDir(tmpRoot, { id: 'invalid', frames: 3 })
    await fs.rm(path.join(fixture.root, 'clips/idle/idle_003.webp'))
    const zip = await zipFromPackDir(fixture.root)
    await expect(makeRegistry().install({ kind: 'zip', data: zip })).rejects.toThrow(/incomplete|is missing/)
    expect(await fs.readdir(userRoot)).toEqual([])
  })

  it('refuses to replace a bundled (protected) pack', async () => {
    await createPackDir(bundledRoot, { id: 'bigfish', useClipsLayout: false })
    const fixture = await createPackDir(tmpRoot, { id: 'bigfish', useClipsLayout: false, version: '9.9.9' })
    const zip = await zipFromPackDir(fixture.root)
    await expect(makeRegistry().install({ kind: 'zip', data: zip })).rejects.toThrow(/built-in pet/)
    // Bundled copy untouched.
    const bundled = await loadPetPack(path.join(bundledRoot, 'bigfish'))
    expect(bundled.manifest.version).not.toBe('9.9.9')
  })

  it('blocks case-insensitive collisions with the bundled id', async () => {
    await createPackDir(bundledRoot, { id: 'bigfish', useClipsLayout: false })
    const fixture = await createPackDir(tmpRoot, { id: 'BigFish', useClipsLayout: false })
    const zip = await zipFromPackDir(fixture.root)
    await expect(makeRegistry().install({ kind: 'zip', data: zip })).rejects.toThrow(/built-in pet/)
    expect(await fs.readdir(userRoot)).toEqual([])
  })

  it('updates an existing pack with the same id and reports previousVersion', async () => {
    const v1 = await createPackDir(userRoot, { id: 'upd', useClipsLayout: false, version: '1.0.0' })
    const v2 = await createPackDir(tmpRoot, { id: 'upd', useClipsLayout: false, version: '2.0.0' })
    const registry = makeRegistry()
    await registry.install({ kind: 'directory', path: v1.root })
    const result = await registry.install({ kind: 'directory', path: v2.root })
    expect(result).toMatchObject({ id: 'upd', updated: true, previousVersion: '1.0.0', version: '2.0.0' })
    const landed = await loadPetPack(path.join(userRoot, 'upd'))
    expect(landed.manifest.version).toBe('2.0.0')
  })

  it('keeps the current pack when an update fails, and leaves no staging leftovers', async () => {
    const v1 = await createPackDir(userRoot, { id: 'rb', useClipsLayout: false, version: '1.0.0' })
    const registry = makeRegistry()
    await registry.install({ kind: 'directory', path: v1.root })

    // Invalid v3 (corrupt frames): must be rejected without touching v2.
    const v3bad = await createPackDir(tmpRoot, { id: 'rb', useClipsLayout: false, version: '3.0.0', corruptFrames: true })
    await expect(registry.install({ kind: 'directory', path: v3bad.root })).rejects.toThrow(/not a valid WebP/)
    const landed = await loadPetPack(path.join(userRoot, 'rb'))
    expect(landed.manifest.version).toBe('1.0.0')

    // A failed import must never leave staging/backup leftovers behind.
    const bad = buildZip([{ name: 'pet-pack.json', data: 'not json' }])
    await expect(registry.install({ kind: 'zip', data: bad })).rejects.toThrow()
    const leftovers = (await fs.readdir(userRoot)).filter((name) => name.startsWith('.'))
    expect(leftovers).toEqual([])
  })

  it('leaves no staging directories after a failed import', async () => {
    const zip = buildZip([{ name: 'pet-pack.json', data: 'not json' }])
    await expect(makeRegistry().install({ kind: 'zip', data: zip })).rejects.toThrow()
    const leftovers = (await fs.readdir(userRoot)).filter((name) => name.startsWith('.'))
    expect(leftovers).toEqual([])
  })
})

describe('PetPackRegistry.remove', () => {
  it('removes a user-installed pack', async () => {
    const fixture = await createPackDir(userRoot, { id: 'removable', useClipsLayout: false })
    const registry = makeRegistry()
    expect(await registry.detail('removable')).not.toBeNull()
    await registry.remove('removable')
    await expect(fs.access(fixture.root)).rejects.toThrow()
  })

  it('refuses to remove the bundled pack', async () => {
    await createPackDir(bundledRoot, { id: 'bigfish', useClipsLayout: false })
    await expect(makeRegistry().remove('bigfish')).rejects.toThrow(/built-in pet/)
    await expect(fs.access(path.join(bundledRoot, 'bigfish', 'pet-pack.json'))).resolves.toBeUndefined()
  })

  it('refuses to remove ids outside the user root or unknown ids', async () => {
    await expect(makeRegistry().remove('../escape')).rejects.toThrow(/Invalid pet pack id|not a valid installed pack/)
    await expect(makeRegistry().remove('does-not-exist')).rejects.toThrow(/not a valid installed pack/)
  })
})

describe('findPackRoot', () => {
  it('prefers the user pack over the bundled pack with the same id', async () => {
    await createPackDir(bundledRoot, { id: 'dupe', useClipsLayout: false, version: '1.0.0' })
    await createPackDir(userRoot, { id: 'dupe', useClipsLayout: false, version: '2.0.0' })
    const root = await makeRegistry().findPackRoot('dupe')
    expect(root).toBe(path.join(userRoot, 'dupe'))
  })

  it('rejects malformed ids', async () => {
    expect(await makeRegistry().findPackRoot('../etc')).toBeNull()
    expect(await makeRegistry().findPackRoot('')).toBeNull()
  })
})
