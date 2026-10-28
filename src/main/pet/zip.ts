/**
 * Minimal, security-hardened ZIP reader for pet pack imports.
 *
 * Third-party pet packs are untrusted input, so extraction is fail-closed:
 *
 * - ZIP Slip is impossible: entry names must be single relative paths inside
 *   the destination (no absolute paths, no `..` segments, no backslashes,
 *   no drive letters).
 * - Symbolic links, device files and setuid-style entries are rejected.
 * - Encrypted entries are rejected.
 * - Decompression bombs are bounded by per-file size, total size, entry
 *   count and compression-ratio limits checked before inflating.
 * - Extracted bytes are verified against the central-directory size.
 *
 * Only `stored` (0) and `deflate` (8) methods are supported — the formats any
 * sane packer produces for webp/png assets. Everything else is rejected.
 */

import { inflateRawSync } from 'node:zlib'

export const ZIP_LIMITS = Object.freeze({
  maxEntries: 2000,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 200
})

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** Minimum viable EOCD: 22 bytes (no comment). */
const EOCD_MIN_SIZE = 22
const EOCD_MAX_SCAN = EOCD_MIN_SIZE + 0xffff

export interface ZipEntry {
  /** Sanitized, already-safe relative path (forward slashes). */
  name: string
  method: number
  compressedSize: number
  size: number
  /** Raw external attributes (host system dependent). */
  externalAttributes: number
  localHeaderOffset: number
}

export interface ZipLimitsResult {
  ok: boolean
  reason?: string
}

export class ZipFormatError extends Error {}

function readUint32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset)
}

function readUint16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset)
}

/**
 * True when a ZIP entry name is safe to extract below a destination root.
 * Rejects absolute paths, `..` traversal, backslashes, drive letters, and
 * NUL/control characters.
 */
export function isSafeZipEntryName(name: string): boolean {
  // Directory entries carry a trailing slash; validate the path part only.
  const pathPart = name.endsWith('/') ? name.slice(0, -1) : name
  if (!pathPart || pathPart.length > 512) return false
  if (pathPart.includes('\\')) return false
  if (pathPart.includes('\0')) return false
  if (/^[a-zA-Z]:/.test(pathPart)) return false
  if (pathPart.startsWith('/')) return false
  const segments = pathPart.split('/')
  for (const segment of segments) {
    if (!segment || segment === '.') return false
    if (segment === '..') return false
  }
  return true
}

/** Unix mode stashed in the high 16 bits of external attributes. */
export function zipEntryUnixMode(entry: Pick<ZipEntry, 'externalAttributes'>): number {
  return (entry.externalAttributes >>> 16) & 0xffff
}

/**
 * Reject anything that is not a regular file or directory: symlinks (S_IFLNK),
 * char/block devices, FIFOs and sockets.
 */
export function isRegularZipEntry(entry: Pick<ZipEntry, 'externalAttributes'>): boolean {
  const mode = zipEntryUnixMode(entry)
  if (mode === 0) return true // host system 0 (FAT): only regular files exist
  const fileType = mode & 0o170000
  return fileType === 0 || fileType === 0o100000 || fileType === 0o040000
}

/** Locate the End Of Central Directory record (scanning past a possible comment). */
function findEocd(buffer: Buffer): number {
  const minStart = Math.max(0, buffer.length - EOCD_MAX_SCAN)
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= minStart; offset -= 1) {
    if (readUint32(buffer, offset) === EOCD_SIGNATURE) return offset
  }
  throw new ZipFormatError('Not a ZIP archive (missing end-of-central-directory)')
}

/** Parse and sanity-check the central directory. Does not touch entry data. */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEocd(buffer)
  const entryCount = readUint16(buffer, eocdOffset + 10)
  const centralOffset = readUint32(buffer, eocdOffset + 16)
  if (entryCount > ZIP_LIMITS.maxEntries) {
    throw new ZipFormatError(`ZIP has too many entries (${entryCount})`)
  }
  const entries: ZipEntry[] = []
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || readUint32(buffer, offset) !== CENTRAL_SIGNATURE) {
      throw new ZipFormatError('ZIP central directory is corrupt')
    }
    const flags = readUint16(buffer, offset + 8)
    const method = readUint16(buffer, offset + 10)
    const compressedSize = readUint32(buffer, offset + 20)
    const size = readUint32(buffer, offset + 24)
    const nameLength = readUint16(buffer, offset + 28)
    const extraLength = readUint16(buffer, offset + 30)
    const commentLength = readUint16(buffer, offset + 32)
    const externalAttributes = readUint32(buffer, offset + 38)
    const localHeaderOffset = readUint32(buffer, offset + 42)
    const nameEnd = offset + 46 + nameLength
    if (nameEnd + extraLength + commentLength > buffer.length) {
      throw new ZipFormatError('ZIP central directory is corrupt')
    }
    const name = buffer.toString('utf8', offset + 46, nameEnd)
    if ((flags & 0x1) !== 0) throw new ZipFormatError(`Encrypted ZIP entry "${name}"`)
    if (!isSafeZipEntryName(name)) {
      throw new ZipFormatError(`Unsafe ZIP entry path "${name}"`)
    }
    if (!isRegularZipEntry({ externalAttributes })) {
      throw new ZipFormatError(`Unsupported ZIP entry type "${name}" (symlink or special file)`)
    }
    if (size > ZIP_LIMITS.maxFileBytes) {
      throw new ZipFormatError(`ZIP entry "${name}" exceeds the size limit`)
    }
    if (method === 8 && compressedSize > 0 && size / compressedSize > ZIP_LIMITS.maxCompressionRatio) {
      throw new ZipFormatError(`ZIP entry "${name}" has an abnormal compression ratio`)
    }
    if (method !== 0 && method !== 8) {
      throw new ZipFormatError(`ZIP entry "${name}" uses an unsupported compression method`)
    }
    entries.push({ name, method, compressedSize, size, externalAttributes, localHeaderOffset })
    offset = nameEnd + extraLength + commentLength
  }
  return entries
}

/** Inflate one entry's data. Verifies the decompressed size matches the directory. */
export function extractZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const localOffset = entry.localHeaderOffset
  if (localOffset + 30 > buffer.length || readUint32(buffer, localOffset) !== LOCAL_SIGNATURE) {
    throw new ZipFormatError(`ZIP entry "${entry.name}" has a corrupt local header`)
  }
  const nameLength = readUint16(buffer, localOffset + 26)
  const extraLength = readUint16(buffer, localOffset + 28)
  const dataStart = localOffset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > buffer.length) {
    throw new ZipFormatError(`ZIP entry "${entry.name}" data is truncated`)
  }
  const raw = buffer.subarray(dataStart, dataEnd)
  let out: Buffer
  if (entry.method === 0) {
    out = Buffer.from(raw)
  } else {
    try {
      out = inflateRawSync(raw)
    } catch (error) {
      throw new ZipFormatError(`ZIP entry "${entry.name}" failed to inflate`, { cause: error })
    }
  }
  if (out.length !== entry.size) {
    throw new ZipFormatError(`ZIP entry "${entry.name}" size mismatch after decompression`)
  }
  return out
}

export interface ExtractOptions {
  /** Called once per regular file with its safe relative path and bytes. */
  onFile: (name: string, data: Buffer) => void | Promise<void>
  /** Called for directory entries (name ends with "/"). Optional. */
  onDirectory?: (name: string) => void | Promise<void>
}

/**
 * Walk a ZIP buffer and hand every safe regular file to `onFile`.
 * Enforces the total-size budget across all entries.
 */
export async function extractZipBuffer(buffer: Buffer, options: ExtractOptions): Promise<void> {
  const entries = readZipEntries(buffer)
  let totalBytes = 0
  for (const entry of entries) {
    if (entry.name.endsWith('/')) {
      await options.onDirectory?.(entry.name.replace(/\/+$/, ''))
      continue
    }
    totalBytes += entry.size
    if (totalBytes > ZIP_LIMITS.maxTotalBytes) {
      throw new ZipFormatError('ZIP exceeds the total size limit')
    }
    const data = extractZipEntry(buffer, entry)
    await options.onFile(entry.name, data)
  }
}
