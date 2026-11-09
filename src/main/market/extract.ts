import fs from 'node:fs/promises'
import path from 'node:path'
import { x as extractTar } from 'tar'
import { MARKET_BARE_FILES, MARKET_FILE_EXTENSIONS, MARKET_LIMITS } from './limits'

export class MarketPackageError extends Error {}

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
  const stripped = normalized.startsWith('package/') ? normalized.slice('package/'.length) : normalized
  if (!stripped || stripped.split('/').some((part) => part === '..')) {
    throw new MarketPackageError(`Rejected archive path: ${name}`)
  }
  return stripped
}

function allowedFile(relative: string): boolean {
  const base = path.posix.basename(relative).toLowerCase()
  if (MARKET_BARE_FILES.has(base)) return true
  const extension = path.posix.extname(base)
  return MARKET_FILE_EXTENSIONS.has(extension)
}

export async function extractMarketTarball(tarball: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true })
  let entries = 0
  let unpacked = 0
  let rejection: Error | null = null
  await extractTar({
    file: tarball,
    cwd: destination,
    strict: true,
    preservePaths: false,
    unlink: false,
    filter(entryPath, entry) {
      if (rejection) return false
      try {
        entries += 1
        if (entries > MARKET_LIMITS.maxEntries) throw new MarketPackageError('Package has too many files')
        const type = 'type' in entry ? String(entry.type) : 'File'
        if (type !== 'File' && type !== 'Directory') {
          throw new MarketPackageError(`Rejected archive entry type ${type}`)
        }
        const relative = assertSafeRelative(entryPath)
        const size = Number(entry.size ?? 0)
        if (!Number.isFinite(size) || size < 0 || size > MARKET_LIMITS.maxFileBytes) {
          throw new MarketPackageError(`Rejected archive entry size: ${entryPath}`)
        }
        unpacked += size
        if (unpacked > MARKET_LIMITS.maxUnpackedBytes) {
          throw new MarketPackageError('Package unpacks beyond the size limit')
        }
        if (type === 'File' && !allowedFile(relative)) {
          throw new MarketPackageError(`Rejected archive file: ${relative}`)
        }
        return true
      } catch (error) {
        rejection = error instanceof Error ? error : new MarketPackageError(String(error))
        return false
      }
    }
  })
  if (rejection) {
    await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined)
    throw rejection
  }
  await assertExtractedTree(destination)
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
      const unpacked = relative.startsWith('package/') ? relative.slice('package/'.length) : relative
      if (!allowedFile(unpacked)) throw new MarketPackageError(`Rejected extracted file: ${unpacked}`)
    }
  }
}

export async function readPackageRoot(extracted: string): Promise<string> {
  const nested = path.join(extracted, 'package')
  try {
    const stat = await fs.stat(nested)
    if (stat.isDirectory()) return nested
  } catch {
    // A fixture may already be a package root.
  }
  return extracted
}
