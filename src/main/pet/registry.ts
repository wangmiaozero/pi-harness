/**
 * Pet pack registry — discovers, installs, updates and removes packs.
 *
 * Two roots are served:
 * - the bundled (read-only) pack root inside app Resources (e.g. BigFish)
 * - the user pack root at `<userData>/petpacks/` where imports are installed
 *
 * Installs are staged into `<userRoot>/.staging/<random>` and only renamed
 * into place after full validation, so a failed import can never leave a
 * half-installed pack behind. Updating an existing pack backs the old files
 * up first and restores them if the new copy fails to land. Bundled packs
 * are immutable: imports colliding with a bundled id are rejected, and the
 * registry never writes outside the user pack root.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  isProtectedPackId,
  type PetPackDetail,
  type PetPackInstallResult,
  type PetPackManifest,
  type PetPackSummary
} from '@shared/pet/desktop'
import { ZIP_LIMITS, extractZipBuffer, readZipEntries, ZipFormatError, type ZipEntry } from './zip'
import { loadPetPack, type LoadedPetPack } from './pack'

export type { PetPackDetail, PetPackInstallResult, PetPackSummary }

export type PetPackInstallSource =
  | { kind: 'zip'; data: Buffer }
  | { kind: 'directory'; path: string }

export class PetPackError extends Error {}

function toSummary(manifest: PetPackManifest, bundled: boolean, compatible = true, resourceError?: string): PetPackSummary {
  return {
    id: manifest.id,
    name: manifest.name,
    nameEn: manifest.nameEn,
    author: manifest.author,
    version: manifest.version,
    description: manifest.description,
    license: manifest.license,
    bundled,
    compatible,
    resourceError,
    clipCount: Object.keys(manifest.clips).length,
    baseWidth: manifest.baseWidth,
    baseHeight: manifest.baseHeight,
    fps: manifest.fps,
    preview: manifest.preview,
    defaultAnimation: manifest.defaultAnimation,
    recommendedSize: manifest.recommendedSize
  }
}

/** WebP files start with "RIFF" and carry "WEBP" at offset 8. */
export function isWebpBuffer(data: Buffer): boolean {
  return (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  )
}

/** PNG / JPEG / WebP magic-byte check for preview images. */
export function isImageBuffer(data: Buffer): boolean {
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return true
  if (data.length >= 8 && data.subarray(0, 4).toString('latin1') === '\x89PNG') return true
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return true
  return false
}

/** Frame file convention shared with the renderer player: `<clip>_001.webp`. */
function frameFileName(clipDir: string, index: number): string {
  const name = clipDir.split('/').pop() ?? clipDir
  return `${name}_${String(index + 1).padStart(3, '0')}.webp`
}

/**
 * Deep resource validation: every declared frame exists, sampled frames are
 * real WebP files, and the pack has a playable default animation. Used for
 * imports (bundled packs were validated at release time and only get the
 * cheap loadPetPack checks).
 */
export async function validatePackResources(pack: LoadedPetPack): Promise<void> {
  const { root, manifest } = pack
  if (!manifest.clips['idle'] && !manifest.defaultAnimation) {
    throw new PetPackError('Pet pack has no idle or default animation')
  }
  if (manifest.preview) {
    try {
      const preview = await fs.readFile(path.join(root, manifest.preview))
      if (!isImageBuffer(preview)) {
        throw new PetPackError('Pet pack preview is not a valid PNG/JPEG/WebP image')
      }
    } catch (error) {
      if (error instanceof PetPackError) throw error
      throw new PetPackError(`Pet pack preview file "${manifest.preview}" is missing`)
    }
  }
  for (const clip of Object.values(manifest.clips)) {
    for (let index = 0; index < clip.frames; index += 1) {
      const file = path.join(root, clip.dir, frameFileName(clip.dir, index))
      let data: Buffer
      try {
        data = await fs.readFile(file)
      } catch {
        throw new PetPackError(`Pet pack frame "${clip.dir}/${frameFileName(clip.dir, index)}" is missing`)
      }
      if (!isWebpBuffer(data)) {
        throw new PetPackError(
          `Pet pack frame "${clip.dir}/${frameFileName(clip.dir, index)}" is not a valid WebP file`
        )
      }
    }
  }
}

function assertDirectoryWithin(parent: string, candidate: string): string {
  const resolved = path.resolve(candidate)
  if (resolved !== parent && !resolved.startsWith(parent + path.sep)) {
    throw new PetPackError('Pet pack path escapes the pack directory')
  }
  return resolved
}

export class PetPackRegistry {
  constructor(
    private readonly bundledRoot: string,
    private readonly userRoot: string
  ) {}

  get userPacksRoot(): string {
    return this.userRoot
  }

  private stagingRoot(): string {
    return path.join(this.userRoot, '.staging')
  }

  /** Locate a pack by id: user packs first, then bundled packs. */
  async findPackRoot(id: string): Promise<string | null> {
    if (!/^[\w-]{1,64}$/.test(id)) return null
    for (const root of [path.join(this.userRoot, id), path.join(this.bundledRoot, id)]) {
      try {
        await fs.access(path.join(root, 'pet-pack.json'))
        return root
      } catch {
        // try next root
      }
    }
    return null
  }

  async list(): Promise<PetPackSummary[]> {
    const summaries: PetPackSummary[] = []
    const seen = new Set<string>()
    for (const [root, bundled] of [
      [this.bundledRoot, true],
      [this.userRoot, false]
    ] as const) {
      let dirs: string[]
      try {
        dirs = await fs.readdir(root)
      } catch {
        continue
      }
      for (const dir of dirs) {
        if (dir.startsWith('.')) continue
        const packRoot = path.join(root, dir)
        try {
          const pack = await loadPetPack(packRoot)
          if (seen.has(pack.manifest.id)) continue
          seen.add(pack.manifest.id)
          summaries.push(toSummary(pack.manifest, bundled))
        } catch (error) {
          // A broken pack stays visible (marked incompatible) when we can read
          // enough of its manifest; otherwise it is skipped entirely.
      const partial = await this.partialSummary(packRoot, bundled, error)
          if (partial) summaries.push(partial)
          else if (bundled) throw error // a broken bundled pack is a build defect
        }
      }
    }
    summaries.sort((a, b) => {
      if (a.bundled !== b.bundled) return a.bundled ? -1 : 1
      return a.id.localeCompare(b.id)
    })
    return summaries
  }

  private async partialSummary(packRoot: string, bundled: boolean, cause: unknown): Promise<PetPackSummary | null> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(packRoot, 'pet-pack.json'), 'utf8'))
      if (typeof raw?.['id'] !== 'string' || typeof raw?.['name'] !== 'string') return null
      return {
        id: raw['id'],
        name: raw['name'],
        nameEn: typeof raw['nameEn'] === 'string' ? raw['nameEn'] : raw['name'],
        author: typeof raw['author'] === 'string' ? raw['author'] : '',
        version: typeof raw['version'] === 'string' ? raw['version'] : '0.0.0',
        license: typeof raw['license'] === 'string' ? raw['license'] : '',
        bundled,
        compatible: false,
        resourceError: errorText(cause),
        clipCount: 0,
        baseWidth: 0,
        baseHeight: 0,
        fps: 0
      }
    } catch {
      return null
    }
  }

  async detail(id: string): Promise<PetPackDetail | null> {
    const root = await this.findPackRoot(id)
    if (!root) return null
    try {
      const pack = await loadPetPack(root)
      const bundled = root.startsWith(path.resolve(this.bundledRoot) + path.sep)
      const summary = toSummary(pack.manifest, bundled)
      return { ...summary, clips: pack.manifest.clips, agentStateMapping: pack.manifest.agentStateMapping, licenseFiles: pack.manifest.licenseFiles }
    } catch (error) {
      const partial = await this.partialSummary(root, false, error)
      return partial ? { ...partial, clips: {}, agentStateMapping: undefined, licenseFiles: [] } : null
    }
  }

  /**
   * Import a pack from a ZIP buffer or a local directory. Validates fully,
   * stages atomically, and replaces an existing user pack with the same id
   * only after the replacement is confirmed intact (rollback on failure).
   */
  async install(source: PetPackInstallSource): Promise<PetPackInstallResult> {
    await fs.mkdir(this.userRoot, { recursive: true })
    await fs.rm(this.stagingRoot(), { recursive: true, force: true })
    const staging = path.join(this.stagingRoot(), randomBytes(8).toString('hex'))
    await fs.mkdir(staging, { recursive: true })
    try {
      if (source.kind === 'zip') {
        await this.extractZipInto(source.data, staging)
      } else {
        await this.copyDirectoryInto(source.path, staging)
      }
      const pack = await loadPetPack(staging)
      // Full resource validation on every import: frame count by naming
      // convention, WebP magic per frame, and a decodable preview image.
      await validatePackResources(pack)
      const id = pack.manifest.id
      if (isProtectedPackId(id)) {
        throw new PetPackError(`"${id}" is a built-in pet and cannot be replaced by an import`)
      }
      const existingRoot = path.join(this.userRoot, id)
      let updated = false
      let previousVersion: string | undefined
      try {
        const existing = await loadPetPack(existingRoot)
        previousVersion = existing.manifest.version
        updated = true
      } catch {
        // no existing pack with this id
      }
      // Land the pack: back up any previous copy, swap the staging dir in,
      // and restore the backup if the swap fails.
      const backup = path.join(this.userRoot, `.staging-backup-${randomBytes(4).toString('hex')}`)
      if (updated) {
        await fs.rm(backup, { recursive: true, force: true })
        await fs.rename(existingRoot, backup)
      }
      try {
        await fs.rename(staging, existingRoot)
        await loadPetPack(existingRoot)
        await fs.rm(this.stagingRoot(), { recursive: true, force: true })
      } catch (error) {
        await fs.rm(existingRoot, { recursive: true, force: true })
        if (updated) await fs.rename(backup, existingRoot)
        throw error
      } finally {
        await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined)
      }
      return { id, name: pack.manifest.name, version: pack.manifest.version, updated, previousVersion }
    } catch (error) {
      // Wipe the entire staging tree (parent included) — nothing partial may
      // outlive a failed import.
      await fs.rm(this.stagingRoot(), { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  /** Remove a user-installed pack. Bundled packs can never be removed. */
  async remove(id: string): Promise<void> {
    if (isProtectedPackId(id)) {
      throw new PetPackError('The built-in pet cannot be uninstalled')
    }
    if (!/^[\w-]{1,64}$/.test(id)) {
      throw new PetPackError('Invalid pet pack id')
    }
    const target = assertDirectoryWithin(this.userRoot, path.join(this.userRoot, id))
    try {
      await loadPetPack(target) // confirm it really is a pack below userRoot
    } catch (error) {
      throw new PetPackError(`Pet pack "${id}" is not a valid installed pack`, { cause: error })
    }
    await fs.rm(target, { recursive: true, force: true })
  }

  private async extractZipInto(data: Buffer, staging: string): Promise<void> {
    let entries: ZipEntry[]
    try {
      entries = readZipEntries(data)
    } catch (error) {
      throw new PetPackError(error instanceof Error ? error.message : 'Invalid ZIP archive', { cause: error })
    }
    const manifestEntry = entries.find((entry) => entry.name === 'pet-pack.json')
    if (!manifestEntry) {
      throw new PetPackError('ZIP is missing pet-pack.json at the archive root')
    }
    await extractZipBuffer(data, {
      onFile: async (name, fileData) => {
        const target = path.join(staging, ...name.split('/'))
        assertDirectoryWithin(staging, target)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, fileData)
      },
      onDirectory: async (name) => {
        await fs.mkdir(path.join(staging, ...name.split('/')), { recursive: true })
      }
    })
  }

  private async copyDirectoryInto(sourcePath: string, staging: string): Promise<void> {
    const sourceRoot = path.resolve(sourcePath)
    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(sourceRoot)
    } catch {
      throw new PetPackError('The selected pet directory does not exist')
    }
    if (!stat.isDirectory()) throw new PetPackError('The selected path is not a directory')
    try {
      await fs.access(path.join(sourceRoot, 'pet-pack.json'))
    } catch {
      throw new PetPackError('The directory is missing pet-pack.json')
    }
    let fileCount = 0
    let totalBytes = 0
    const walk = async (dir: string): Promise<void> => {
      const children = await fs.readdir(dir, { withFileTypes: true })
      for (const child of children) {
        const childPath = path.join(dir, child.name)
        if (child.isSymbolicLink()) {
          throw new PetPackError('The pet directory contains symbolic links, which are not allowed')
        }
        const relative = path.relative(sourceRoot, childPath)
        if (child.isDirectory()) {
          await fs.mkdir(path.join(staging, relative), { recursive: true })
          await walk(childPath)
          continue
        }
        if (!child.isFile()) {
          throw new PetPackError('The pet directory contains special files, which are not allowed')
        }
        fileCount += 1
        if (fileCount > ZIP_LIMITS.maxEntries) {
          throw new PetPackError('The pet directory contains too many files')
        }
        const fileStat = await fs.stat(childPath)
        if (fileStat.size > ZIP_LIMITS.maxFileBytes) {
          throw new PetPackError(`File "${relative}" exceeds the size limit`)
        }
        totalBytes += fileStat.size
        if (totalBytes > ZIP_LIMITS.maxTotalBytes) {
          throw new PetPackError('The pet directory exceeds the total size limit')
        }
        const target = assertDirectoryWithin(staging, path.join(staging, relative))
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.copyFile(childPath, target)
      }
    }
    await fs.mkdir(staging, { recursive: true })
    await walk(sourceRoot)
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export { ZipFormatError }
