/**
 * Shared fixtures for pet pack tests. Test-only helpers — never imported by
 * production code.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'

/** Minimal valid WebP: RIFF header + WEBP tag + a VP8X chunk. */
export function webpFrame(): Buffer {
  return Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.from([0x18, 0x00, 0x00, 0x00]),
    Buffer.from('WEBPVP8X', 'latin1'),
    Buffer.alloc(10)
  ])
}

/** Minimal PNG: signature + IHDR chunk. */
export function pngImage(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(20)
  ])
}

/** Not-a-WebP bytes (plain text) for corruption tests. */
export function junkBytes(): Buffer {
  return Buffer.from('definitely not a webp frame at all')
}

export interface ZipEntrySpec {
  name: string
  data: Buffer | string
  method?: 0 | 8
  externalAttributes?: number
  flags?: number
}

/**
 * Minimal ZIP writer: builds a real archive (local headers + central
 * directory + EOCD) so readers run against byte-accurate input.
 */
export function buildZip(entries: ZipEntrySpec[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const method = entry.method ?? 0
    const stored = method === 8 ? deflateRawSync(raw) : raw
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.flags ?? 0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 12)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, stored)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(entry.flags ?? 0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(0, 14)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(entry.externalAttributes ?? ((0o100644 << 16) >>> 0), 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + stored.length
  }
  const centralStart = offset
  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(centralStart, 16)
  return Buffer.concat([...locals, centralBytes, eocd])
}

export interface PackFixtureOptions {
  id: string
  version?: string
  /** Frame count per clip (minimum 1). */
  frames?: number
  /** On-disk layout: clip dir becomes `clips/<name>` when true. */
  useClipsLayout?: boolean
  preview?: boolean | Buffer
  /** Overwrite the manifest entirely (for invalid-manifest tests). */
  manifestOverride?: Record<string, unknown>
  /** Write junk bytes instead of WebP frames. */
  corruptFrames?: boolean
  extraClips?: Array<{ name: string; dir?: string; frames?: number; loop?: boolean }>
  agentStateMapping?: Record<string, string>
  defaultAnimation?: string
}

export interface PackFixture {
  root: string
  manifest: Record<string, unknown>
  manifestJson: string
}

/** Build a minimal-but-valid pack directory under `parent`. */
export async function createPackDir(parent: string, options: PackFixtureOptions): Promise<PackFixture> {
  const root = path.join(parent, options.id)
  const clipName = 'idle'
  const clipDir = options.useClipsLayout === false ? clipName : `clips/${clipName}`
  const frames = Math.max(1, options.frames ?? 2)
  const clips: Record<string, unknown> = {
    [clipName]: { dir: clipDir, frames, loop: true }
  }
  for (const extra of options.extraClips ?? []) {
    clips[extra.name] = {
      dir: extra.dir ?? `clips/${extra.name}`,
      frames: extra.frames ?? 1,
      loop: extra.loop !== false
    }
  }
  const manifest: Record<string, unknown> = options.manifestOverride ?? {
    formatVersion: 1,
    id: options.id,
    name: `Pack ${options.id}`,
    nameEn: `Pack ${options.id}`,
    author: 'tester',
    version: options.version ?? '1.0.0',
    license: 'MIT',
    licenseFiles: ['LICENSE'],
    source: 'test fixture',
    baseWidth: 200,
    baseHeight: 160,
    fps: 24,
    clips,
    ...(options.preview ? { preview: 'preview.png' } : {}),
    ...(options.defaultAnimation ? { defaultAnimation: options.defaultAnimation } : {}),
    ...(options.agentStateMapping ? { agentStateMapping: options.agentStateMapping } : {})
  }
  await fs.mkdir(path.join(root, clipDir), { recursive: true })
  await fs.writeFile(path.join(root, 'pet-pack.json'), JSON.stringify(manifest))
  await fs.writeFile(path.join(root, 'LICENSE'), 'MIT License\n')
  const frameBase = clipDir.split('/').pop() ?? clipName
  for (let index = 1; index <= frames; index += 1) {
    const data = options.corruptFrames ? junkBytes() : webpFrame()
    await fs.writeFile(path.join(root, clipDir, `${frameBase}_${String(index).padStart(3, '0')}.webp`), data)
  }
  for (const extra of options.extraClips ?? []) {
    const extraDir = extra.dir ?? `clips/${extra.name}`
    const extraBase = extraDir.split('/').pop() ?? extra.name
    const extraFrames = Math.max(1, extra.frames ?? 1)
    await fs.mkdir(path.join(root, extraDir), { recursive: true })
    for (let index = 1; index <= extraFrames; index += 1) {
      await fs.writeFile(
        path.join(root, extraDir, `${extraBase}_${String(index).padStart(3, '0')}.webp`),
        options.corruptFrames ? junkBytes() : webpFrame()
      )
    }
  }
  if (options.preview) {
    await fs.writeFile(path.join(root, 'preview.png'), options.preview === true ? pngImage() : options.preview)
  }
  const manifestJson = JSON.stringify(manifest)
  return { root, manifest, manifestJson }
}

/** Build a ZIP whose contents equal a pack fixture directory. */
export async function zipFromPackDir(packRoot: string): Promise<Buffer> {
  const entries: ZipEntrySpec[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const children = await fs.readdir(dir, { withFileTypes: true })
    for (const child of children) {
      const childPath = path.join(dir, child.name)
      const name = prefix ? `${prefix}/${child.name}` : child.name
      if (child.isDirectory()) {
        entries.push({ name: `${name}/`, data: Buffer.alloc(0), externalAttributes: (0o040755 << 16) >>> 0 })
        await walk(childPath, name)
        continue
      }
      entries.push({ name, data: await fs.readFile(childPath), method: 8 })
    }
  }
  await walk(packRoot, '')
  return buildZip(entries)
}
