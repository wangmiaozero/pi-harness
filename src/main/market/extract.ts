import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createRequire } from 'node:module'
import { MARKET_BARE_FILES, MARKET_FILE_EXTENSIONS, MARKET_LIMITS } from './limits'

const { Open } = createRequire(import.meta.url)('unzipper') as {
  Open: {
    file(file: string): Promise<{
      files: Array<{
        path: string
        type: string
        uncompressedSize: number
        externalFileAttributes: number
        stream(): NodeJS.ReadableStream
      }>
    }>
  }
}

export class MarketPackageError extends Error {}

export function assertZipEntryMode(externalFileAttributes: number): void {
  const mode = (externalFileAttributes >>> 16) & 0o170000
  if (mode && mode !== 0o100000 && mode !== 0o040000) {
    throw new MarketPackageError(`Rejected archive entry type ${mode.toString(8)}`)
  }
}

function assertSafeRelative(name: string): string {
  const normalized = name.replaceAll('\\', '/').replace(/^\.\/+/, '')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    path.posix.isAbsolute(normalized) ||
    normalized.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new MarketPackageError(`Rejected archive path: ${name}`)
  }
  return normalized
}

function allowedFile(relative: string): boolean {
  const base = path.posix.basename(relative).toLowerCase()
  if (MARKET_BARE_FILES.has(base)) return true
  return MARKET_FILE_EXTENSIONS.has(path.posix.extname(base))
}

export async function extractMarketZip(
  archive: string,
  destination: string,
  expectedUnpacked: number,
  signal?: AbortSignal
): Promise<void> {
  const zip = await Open.file(archive)
  let entries = 0
  let unpacked = 0
  const files: Array<{ relative: string; entry: (typeof zip.files)[number] }> = []
  for (const entry of zip.files) {
    entries += 1
    if (entries > MARKET_LIMITS.maxEntries) throw new MarketPackageError('Package has too many files')
    assertZipEntryMode(entry.externalFileAttributes)
    if (entry.type === 'Directory') continue
    if (entry.type !== 'File') throw new MarketPackageError(`Rejected archive entry type ${entry.type}`)
    const relative = assertSafeRelative(entry.path)
    if (!Number.isInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > MARKET_LIMITS.maxFileBytes) {
      throw new MarketPackageError(`Rejected archive entry size: ${entry.path}`)
    }
    unpacked += entry.uncompressedSize
    if (unpacked > MARKET_LIMITS.maxUnpackedBytes) throw new MarketPackageError('Package unpacks beyond the size limit')
    if (!allowedFile(relative)) throw new MarketPackageError(`Rejected archive file: ${relative}`)
    files.push({ relative, entry })
  }
  if (unpacked !== expectedUnpacked) throw new MarketPackageError('Package unpack size does not match the catalog')
  await fs.mkdir(destination, { recursive: true })
  try {
    for (const file of files) {
      signal?.throwIfAborted()
      const target = path.join(destination, file.relative)
      if (target !== destination && !target.startsWith(destination + path.sep)) {
        throw new MarketPackageError(`Rejected archive path: ${file.relative}`)
      }
      await fs.mkdir(path.dirname(target), { recursive: true })
      await pipeline(file.entry.stream(), createWriteStream(target, { flags: 'wx', mode: 0o644 }))
    }
    await assertExtractedTree(destination)
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function assertExtractedTree(root: string): Promise<void> {
  const pending = [root]
  while (pending.length) {
    const current = pending.pop()!
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      const stat = await fs.lstat(full)
      if (stat.isSymbolicLink()) throw new MarketPackageError(`Rejected symlink: ${entry.name}`)
      if (stat.isDirectory()) {
        pending.push(full)
        continue
      }
      if (!stat.isFile()) throw new MarketPackageError(`Rejected special file: ${entry.name}`)
      const relative = path.relative(root, full).replaceAll('\\', '/')
      if (!allowedFile(relative)) throw new MarketPackageError(`Rejected extracted file: ${relative}`)
    }
  }
}

export async function readPackageRoot(extracted: string): Promise<string> {
  try {
    const stat = await fs.stat(path.join(extracted, 'package.json'))
    if (!stat.isFile()) throw new Error('missing')
  } catch {
    throw new MarketPackageError('Package archive is missing package.json')
  }
  return extracted
}
