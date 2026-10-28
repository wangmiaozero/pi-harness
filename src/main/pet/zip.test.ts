import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { ZipEntrySpec } from './test-fixtures'
import {
  ZIP_LIMITS,
  extractZipBuffer,
  extractZipEntry,
  isSafeZipEntryName,
  isRegularZipEntry,
  readZipEntries,
  ZipFormatError
} from './zip'

/**
 * Minimal ZIP writer for tests: builds a real archive (local headers +
 * central directory + EOCD) so every check runs against byte-accurate input.
 */
function buildZip(
  entries: Array<{
    name: string
    data: Buffer | string
    method?: 0 | 8
    externalAttributes?: number
    flags?: number
  }>
): Buffer {
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
    local.writeUInt16LE(0, 10)
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
    central.writeUInt16LE(0, 12)
    central.writeUInt32LE(0, 14)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(entry.externalAttributes ?? ((0o100644 << 16) >>> 0), 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + stored.length
  }
  const centralStart = offset
  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(centralStart, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBytes, eocd])
}

const SYMLINK_ATTRS = ((0o120777 << 16) | 0) >>> 0
const FIFO_ATTRS = ((0o010644 << 16) | 0) >>> 0

describe('isSafeZipEntryName', () => {
  it('accepts plain relative paths', () => {
    expect(isSafeZipEntryName('pet-pack.json')).toBe(true)
    expect(isSafeZipEntryName('clips/idle/idle_001.webp')).toBe(true)
  })

  it('rejects path traversal and absolute paths', () => {
    expect(isSafeZipEntryName('../pet-pack.json')).toBe(false)
    expect(isSafeZipEntryName('a/../../etc/passwd')).toBe(false)
    expect(isSafeZipEntryName('/etc/passwd')).toBe(false)
    expect(isSafeZipEntryName('C:/pet-pack.json')).toBe(false)
  })

  it('rejects backslashes, NUL bytes and empty names', () => {
    expect(isSafeZipEntryName('clips\\idle\\idle_001.webp')).toBe(false)
    expect(isSafeZipEntryName('a\0b')).toBe(false)
    expect(isSafeZipEntryName('')).toBe(false)
    expect(isSafeZipEntryName('a//b')).toBe(false)
    expect(isSafeZipEntryName('clips/idle/')).toBe(true)
  })
})

describe('isRegularZipEntry', () => {
  it('accepts regular files, directories and mode-less entries', () => {
    expect(isRegularZipEntry({ externalAttributes: 0o100644 << 16 })).toBe(true)
    expect(isRegularZipEntry({ externalAttributes: 0o040755 << 16 })).toBe(true)
    expect(isRegularZipEntry({ externalAttributes: 0 })).toBe(true)
  })

  it('rejects symlinks and FIFOs', () => {
    expect(isRegularZipEntry({ externalAttributes: SYMLINK_ATTRS })).toBe(false)
    expect(isRegularZipEntry({ externalAttributes: FIFO_ATTRS })).toBe(false)
  })
})

describe('readZipEntries', () => {
  it('lists entries of a valid archive', () => {
    const zip = buildZip([
      { name: 'pet-pack.json', data: '{}' },
      { name: 'clips/idle/idle_001.webp', data: Buffer.from('RIFF0000WEBPVP8X'), method: 8 }
    ])
    const entries = readZipEntries(zip)
    expect(entries.map((entry) => entry.name)).toEqual([
      'pet-pack.json',
      'clips/idle/idle_001.webp'
    ])
    expect(entries[1]!.method).toBe(8)
  })

  it('rejects non-ZIP buffers', () => {
    expect(() => readZipEntries(Buffer.from('not a zip at all'))).toThrow(ZipFormatError)
  })

  it('rejects unsafe entry paths (ZIP Slip)', () => {
    const zip = buildZip([{ name: '../escape.txt', data: 'x' }])
    expect(() => readZipEntries(zip)).toThrow(/Unsafe ZIP entry path/)
  })

  it('rejects symlink entries', () => {
    const zip = buildZip([{ name: 'link', data: '/etc/passwd', externalAttributes: SYMLINK_ATTRS }])
    expect(() => readZipEntries(zip)).toThrow(/symlink or special file/)
  })

  it('rejects encrypted entries', () => {
    const zip = buildZip([{ name: 'secret.txt', data: 'x', flags: 0x1 }])
    expect(() => readZipEntries(zip)).toThrow(/Encrypted ZIP entry/)
  })

  it('rejects unsupported compression methods', () => {
    const zip = buildZip([{ name: 'file.bin', data: 'x', method: 12 as number } as ZipEntrySpec])
    expect(() => readZipEntries(zip)).toThrow(/unsupported compression method/)
  })

  it('rejects oversized entries declared in the central directory', () => {
    const zip = buildZip([{ name: 'big.bin', data: 'x' }])
    // Patch declared size beyond the limit while keeping the format valid.
    const centralOffset = zip.readUInt32LE(zip.length - 22 + 16)
    zip.writeUInt32LE(ZIP_LIMITS.maxFileBytes + 1, centralOffset + 24)
    expect(() => readZipEntries(zip)).toThrow(/exceeds the size limit/)
  })

  it('rejects decompression bombs via the compression-ratio check', () => {
    const zip = buildZip([{ name: 'bomb.bin', data: 'x', method: 8 }])
    const centralOffset = zip.readUInt32LE(zip.length - 22 + 16)
    zip.writeUInt32LE(ZIP_LIMITS.maxFileBytes, centralOffset + 24) // declared size
    expect(() => readZipEntries(zip)).toThrow(/abnormal compression ratio/)
  })
})

describe('extractZipBuffer', () => {
  it('extracts stored and deflated files in order', async () => {
    const zip = buildZip([
      { name: 'pet-pack.json', data: '{"id":"x"}', method: 8 },
      { name: 'clips/idle/idle_001.webp', data: Buffer.from('RIFF0000WEBPVP8X') }
    ])
    const files: Array<[string, Buffer]> = []
    await extractZipBuffer(zip, {
      onFile: async (name, data) => {
        files.push([name, data])
      }
    })
    expect(files.map(([name]) => name)).toEqual(['pet-pack.json', 'clips/idle/idle_001.webp'])
    expect(files[0]![1].toString()).toBe('{"id":"x"}')
  })

  it('reports directory entries to onDirectory', async () => {
    const zip = buildZip([
      { name: 'clips/', data: Buffer.alloc(0), externalAttributes: 0o040755 << 16 },
      { name: 'pet-pack.json', data: '{}' }
    ])
    const dirs: string[] = []
    await extractZipBuffer(zip, { onFile: async () => undefined, onDirectory: async (name) => {
        dirs.push(name)
      } })
    expect(dirs).toEqual(['clips'])
  })

  it('fails on a corrupt local header', async () => {
    const zip = buildZip([{ name: 'a.txt', data: 'hello' }])
    zip.writeUInt32LE(0xdeadbeef, 0)
    await expect(
      extractZipBuffer(zip, { onFile: async () => undefined })
    ).rejects.toThrow(ZipFormatError)
  })

  it('fails when decompressed size does not match the directory', async () => {
    const zip = buildZip([{ name: 'a.txt', data: 'hello' }])
    const centralOffset = zip.readUInt32LE(zip.length - 22 + 16)
    zip.writeUInt32LE(99, centralOffset + 24) // lie about the size
    await expect(
      extractZipBuffer(zip, { onFile: async () => undefined })
    ).rejects.toThrow(/size mismatch/)
  })

  it('extractZipEntry inflates deflated data directly', () => {
    const zip = buildZip([{ name: 'a.txt', data: 'hello world'.repeat(10), method: 8 }])
    const [entry] = readZipEntries(zip)
    expect(extractZipEntry(zip, entry!).toString()).toBe('hello world'.repeat(10))
  })
})
