import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import semver from 'semver'
import { parseMarketPackageName } from '@shared/market/package-name'
import { validateThemePackManifest, type ThemePackManifest } from '@shared/market/theme-manifest'
import type { MarketInstallResult, MarketProgress } from '@shared/market/types'
import { extractMarketTarball, MarketPackageError, readPackageRoot } from './extract'
import { integrityMatches, sha512FileBase64 } from './hash'
import { MARKET_LIMITS } from './limits'
import { MarketRegistryClient, type RegistryVersion } from './registry-client'

export interface PetDirectoryInstaller {
  install(source: { kind: 'directory'; path: string }): Promise<{ id: string; version: string; updated: boolean }>
}

export interface MarketInstallerOptions {
  root: string
  petRoot?: string
  appVersion: string
  client: MarketRegistryClient
  fetcher?: typeof fetch
  pets: PetDirectoryInstaller
  onProgress?: (progress: MarketProgress) => void
}

interface IndexRecord {
  name: string
  version: string
  integrity: string
  packId: string
  license: string
}

interface AddonRecord extends IndexRecord {
  clips: string[]
}

interface MarketIndex {
  themes: Record<string, IndexRecord>
  pets: Record<string, IndexRecord>
  addons: Record<string, AddonRecord>
}

export class MarketInstaller {
  private readonly jobs = new Map<string, AbortController>()
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly options: MarketInstallerOptions) {}

  async install(name: string, version?: string): Promise<MarketInstallResult> {
    if (!parseMarketPackageName(name)) throw new MarketPackageError(`Refusing unofficial package: ${name}`)
    await this.acquire()
    try {
      return await this.installHeld(name, version)
    } finally {
      this.release()
    }
  }

  private async installHeld(
    name: string,
    version?: string,
    parent?: AbortSignal
  ): Promise<MarketInstallResult> {
    const parsed = parseMarketPackageName(name)
    if (!parsed) throw new MarketPackageError(`Refusing unofficial package: ${name}`)
    if (this.jobs.has(name)) throw new MarketPackageError(`Package is already installing: ${name}`)
    const controller = new AbortController()
    const abort = () => controller.abort()
    parent?.addEventListener('abort', abort)
    if (parent?.aborted) controller.abort()
    this.jobs.set(name, controller)
    const staging = path.join(this.options.root, 'staging', randomBytes(8).toString('hex'))
    try {
      this.progress(name, 'metadata', 0, null)
      const metadata = await this.options.client.package(name)
      const selected = this.options.client.selectVersion(metadata, this.options.appVersion, version)
      if (selected.scripts.length) throw new MarketPackageError('Package install scripts are not allowed')
      const tarball = path.join(staging, 'download.tgz')
      await fs.mkdir(staging, { recursive: true })
      await this.download(name, selected, tarball, controller.signal)
      this.progress(name, 'verify', 0, null)
      const digest = await sha512FileBase64(tarball, controller.signal)
      if (!integrityMatches(selected.integrity, digest)) {
        throw new MarketPackageError('Package integrity check failed')
      }
      this.progress(name, 'extract', 0, null)
      const extracted = path.join(staging, 'extracted')
      await extractMarketTarball(tarball, extracted)
      const packageRoot = await readPackageRoot(extracted)
      await rejectScripts(packageRoot)
      if (selected.partOf) {
        if (parsed.kind !== 'pet') throw new MarketPackageError('Only a pet action pack can be installed on its own')
        const result = await this.commitPetAddon(name, selected, packageRoot, staging, controller.signal)
        this.progress(name, 'done', 1, 1)
        return result
      }
      if (parsed.kind === 'pet' && selected.parts.length) {
        await this.mergePetParts(parsed.name, selected, packageRoot, staging, controller.signal)
      }
      this.progress(name, 'install', 0, null)
      const result =
        parsed.kind === 'theme'
          ? await this.commitTheme(parsed.name, selected, packageRoot)
          : await this.commitPet(parsed.name, selected, packageRoot)
      this.progress(name, 'done', 1, 1)
      return result
    } catch (error) {
      if (controller.signal.aborted) {
        this.progress(name, 'cancelled', 0, null)
        throw new MarketPackageError('Download cancelled')
      }
      this.progress(name, 'error', 0, null, error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      parent?.removeEventListener('abort', abort)
      this.jobs.delete(name)
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  cancel(name: string): void {
    this.jobs.get(name)?.abort()
  }

  private async commitTheme(
    name: string,
    selected: RegistryVersion,
    packageRoot: string
  ): Promise<MarketInstallResult> {
    const manifest = validateThemePackManifest(
      JSON.parse(await fs.readFile(path.join(packageRoot, 'theme-pack.json'), 'utf8'))
    )
    await assertDeclaredAssets(packageRoot, manifest)
    if (!semver.satisfies(semver.coerce(this.options.appVersion)!, manifest.compatiblePiHarness)) {
      throw new MarketPackageError('Theme pack is not compatible with this Pi-Harness version')
    }
    const index = await this.readIndex()
    const previous = index.themes[manifest.id]
    const destination = path.join(this.options.root, 'themes', manifest.id)
    const backup = `${destination}.backup-${randomBytes(4).toString('hex')}`
    const staged = `${destination}.next-${randomBytes(4).toString('hex')}`
    await fs.cp(packageRoot, staged, { recursive: true, verbatimSymlinks: false })
    let moved = false
    try {
      if (previous) await fs.rename(destination, backup).catch(() => undefined)
      await fs.rename(staged, destination)
      moved = true
      index.themes[manifest.id] = record(name, selected, manifest.id, manifest.license)
      await this.writeIndex(index)
      await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined)
    } catch (error) {
      if (moved) await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined)
      await fs.rename(backup, destination).catch(() => undefined)
      throw error
    } finally {
      await fs.rm(staged, { recursive: true, force: true }).catch(() => undefined)
    }
    return { name, version: selected.version, packId: manifest.id, updated: Boolean(previous) }
  }

  private async mergePetParts(
    name: string,
    selected: RegistryVersion,
    packageRoot: string,
    staging: string,
    signal: AbortSignal
  ): Promise<void> {
    for (const [index, partName] of selected.parts.entries()) {
      const metadata = await this.options.client.package(partName)
      const part = this.options.client.selectVersion(metadata, this.options.appVersion, selected.version)
      if (part.partOf !== name) throw new MarketPackageError(`${partName} is not a part of ${name}`)
      if (part.scripts.length) throw new MarketPackageError('Package install scripts are not allowed')
      const tarball = path.join(staging, `part-${index}.tgz`)
      await this.download(name, part, tarball, signal)
      this.progress(name, 'verify', 0, null)
      const digest = await sha512FileBase64(tarball, signal)
      if (!integrityMatches(part.integrity, digest)) throw new MarketPackageError('Package integrity check failed')
      this.progress(name, 'extract', 0, null)
      const extracted = path.join(staging, `part-${index}`)
      await extractMarketTarball(tarball, extracted)
      const partRoot = await readPackageRoot(extracted)
      await rejectScripts(partRoot)
      await mergeClipDirectory(partRoot, packageRoot)
    }
  }

  private async commitPetAddon(
    name: string,
    selected: RegistryVersion,
    packageRoot: string,
    staging: string,
    signal: AbortSignal
  ): Promise<MarketInstallResult> {
    if (!selected.partOf) throw new MarketPackageError('Action pack has no main package')
    if (!this.options.petRoot) throw new MarketPackageError('Pet directory is unavailable')
    const clips = await readClipPack(packageRoot)
    let index = await this.readIndex()
    let main = Object.values(index.pets).find((item) => item.name === selected.partOf)
    if (!main) {
      await this.installHeld(selected.partOf, undefined, signal)
      index = await this.readIndex()
      main = Object.values(index.pets).find((item) => item.name === selected.partOf)
    }
    if (!main) throw new MarketPackageError(`Install ${selected.partOf} before this action pack`)
    const sourcePet = path.join(this.options.petRoot, main.packId)
    try {
      await fs.access(sourcePet)
    } catch {
      throw new MarketPackageError(`Install ${selected.partOf} before this action pack`)
    }
    const work = path.join(staging, 'merged-pet')
    await fs.cp(sourcePet, work, { recursive: true, verbatimSymlinks: false })
    const previous = index.addons[name]
    if (previous?.packId === main.packId) await removeClipDefinitions(work, previous.clips)
    await mergeClipDefinitions(work, clips)
    await mergeClipDirectory(packageRoot, work)
    const installed = await this.options.pets.install({ kind: 'directory', path: work })
    if (installed.id !== main.packId) throw new MarketPackageError('Action pack changed the pet id')
    const latest = await this.readIndex()
    latest.addons[name] = {
      ...record(name, selected, installed.id, selected.license || 'MIT'),
      clips: Object.keys(clips)
    }
    await this.writeIndex(latest)
    return { name, version: selected.version, packId: installed.id, updated: Boolean(previous) }
  }

  private async commitPet(
    name: string,
    selected: RegistryVersion,
    packageRoot: string
  ): Promise<MarketInstallResult> {
    await fs.access(path.join(packageRoot, 'pet-pack.json'))
    const installed = await this.options.pets.install({ kind: 'directory', path: packageRoot })
    const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'pet-pack.json'), 'utf8')) as {
      license?: string
    }
    const index = await this.readIndex()
    index.pets[installed.id] = record(name, selected, installed.id, manifest.license ?? selected.license)
    for (const [addonName, addon] of Object.entries(index.addons)) {
      if (addon.packId === installed.id) delete index.addons[addonName]
    }
    await this.writeIndex(index)
    return {
      name,
      version: selected.version,
      packId: installed.id,
      updated: installed.updated
    }
  }

  async readIndex(): Promise<MarketIndex> {
    try {
      const raw = JSON.parse(await fs.readFile(this.indexPath(), 'utf8')) as MarketIndex
      return {
        themes: raw.themes ?? {},
        pets: raw.pets ?? {},
        addons: normalizeAddons(raw.addons)
      }
    } catch {
      return { themes: {}, pets: {}, addons: {} }
    }
  }

  private async writeIndex(index: MarketIndex): Promise<void> {
    const file = this.indexPath()
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`
    await fs.writeFile(temporary, JSON.stringify(index, null, 2))
    await fs.rename(temporary, file)
  }

  async removeTheme(packId: string): Promise<void> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(packId)) throw new MarketPackageError('Invalid theme id')
    const destination = path.join(this.options.root, 'themes', packId)
    await fs.rm(destination, { recursive: true, force: true })
    const index = await this.readIndex()
    delete index.themes[packId]
    await this.writeIndex(index)
  }

  async removeByPackageName(name: string): Promise<void> {
    const index = await this.readIndex()
    const theme = Object.entries(index.themes).find(([, record]) => record.name === name)
    if (theme) {
      await this.removeTheme(theme[0])
      return
    }
    if (index.addons[name]) {
      await this.removeAddon(name)
      return
    }
    const pet = Object.entries(index.pets).find(([, record]) => record.name === name)
    if (!pet) throw new MarketPackageError(`Package is not installed: ${name}`)
    delete index.pets[pet[0]]
    for (const [addonName, addon] of Object.entries(index.addons)) {
      if (addon.packId === pet[0]) delete index.addons[addonName]
    }
    await this.writeIndex(index)
  }

  async removeAddon(name: string): Promise<void> {
    if (!this.options.petRoot) throw new MarketPackageError('Pet directory is unavailable')
    const index = await this.readIndex()
    const addon = index.addons[name]
    if (!addon) throw new MarketPackageError(`Package is not installed: ${name}`)
    const sourcePet = path.join(this.options.petRoot, addon.packId)
    const staging = path.join(this.options.root, 'staging', randomBytes(8).toString('hex'))
    const work = path.join(staging, 'merged-pet')
    try {
      await fs.cp(sourcePet, work, { recursive: true, verbatimSymlinks: false })
      await removeClipDefinitions(work, addon.clips)
      await this.options.pets.install({ kind: 'directory', path: work })
      const latest = await this.readIndex()
      delete latest.addons[name]
      await this.writeIndex(latest)
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private indexPath(): string {
    return path.join(this.options.root, 'registry.json')
  }

  private async download(name: string, selected: RegistryVersion, file: string, signal: AbortSignal): Promise<void> {
    const fetcher = this.options.fetcher ?? fetch
    const response = await fetcher(selected.tarball, { signal })
    if (!response.ok || !response.body) throw new MarketPackageError(`Download failed: HTTP ${response.status}`)
    const total = Number(response.headers.get('content-length'))
    const limit = Number.isFinite(total) && total > 0 ? total : MARKET_LIMITS.maxTarballBytes
    if (limit > MARKET_LIMITS.maxTarballBytes) throw new MarketPackageError('Package tarball exceeds the size limit')
    let received = 0
    const reader = response.body.getReader()
    const stream = new Readable({
      async read() {
        const chunk = await reader.read()
        if (chunk.done) {
          this.push(null)
          return
        }
        received += chunk.value.byteLength
        if (received > MARKET_LIMITS.maxTarballBytes) {
          this.destroy(new MarketPackageError('Package tarball exceeds the size limit'))
          return
        }
        this.push(Buffer.from(chunk.value))
      }
    })
    const timer = setInterval(() => this.progress(name, 'download', received, Number.isFinite(total) ? total : null), 200)
    try {
      await pipeline(stream, createWriteStream(file, { mode: 0o600 }), { signal })
    } finally {
      clearInterval(timer)
    }
    this.progress(name, 'download', received, Number.isFinite(total) ? total : received)
  }

  private progress(
    name: string,
    phase: MarketProgress['phase'],
    received: number,
    total: number | null,
    message?: string
  ): void {
    this.options.onProgress?.({ name, phase, received, total, message })
  }

  private async acquire(): Promise<void> {
    if (this.active < MARKET_LIMITS.maxConcurrentInstalls) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.active += 1
  }

  private release(): void {
    this.active -= 1
    this.waiters.shift()?.()
  }
}

function record(name: string, selected: RegistryVersion, packId: string, license: string): IndexRecord {
  return { name, version: selected.version, integrity: selected.integrity, packId, license }
}

function normalizeAddons(value: unknown): Record<string, AddonRecord> {
  if (!value || typeof value !== 'object') return {}
  const addons: Record<string, AddonRecord> = {}
  for (const [name, item] of Object.entries(value)) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Partial<AddonRecord>
    if (typeof entry.name !== 'string' || typeof entry.packId !== 'string' || !Array.isArray(entry.clips)) continue
    addons[name] = {
      name: entry.name,
      version: entry.version ?? '',
      integrity: entry.integrity ?? '',
      packId: entry.packId,
      license: entry.license ?? '',
      clips: entry.clips.filter((clip) => typeof clip === 'string')
    }
  }
  return addons
}

async function readClipPack(packageRoot: string): Promise<Record<string, unknown>> {
  let raw: { formatVersion?: unknown; clips?: unknown }
  try {
    raw = JSON.parse(await fs.readFile(path.join(packageRoot, 'clip-pack.json'), 'utf8')) as {
      formatVersion?: unknown
      clips?: unknown
    }
  } catch {
    throw new MarketPackageError('Action pack is missing clip-pack.json')
  }
  if (raw.formatVersion !== 1 || !raw.clips || typeof raw.clips !== 'object' || Array.isArray(raw.clips)) {
    throw new MarketPackageError('Action pack is missing clip-pack.json')
  }
  const clips: Record<string, unknown> = {}
  for (const [name, clip] of Object.entries(raw.clips)) {
    if (!/^[\w][\w.-]*$/.test(name) || !clip || typeof clip !== 'object' || Array.isArray(clip)) {
      throw new MarketPackageError(`Invalid action clip: ${name}`)
    }
    const body = clip as { dir?: unknown; frames?: unknown }
    if (body.dir !== `clips/${name}` || !Number.isInteger(body.frames) || Number(body.frames) < 1) {
      throw new MarketPackageError(`Invalid action clip: ${name}`)
    }
    clips[name] = clip
  }
  const onDisk = (await fs.readdir(path.join(packageRoot, 'clips'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  if (onDisk.length !== Object.keys(clips).length || onDisk.some((name) => clips[name] === undefined)) {
    throw new MarketPackageError('Action pack clips do not match clip-pack.json')
  }
  return clips
}

async function mergeClipDefinitions(petDirectory: string, clips: Record<string, unknown>): Promise<void> {
  const file = path.join(petDirectory, 'pet-pack.json')
  const manifest = JSON.parse(await fs.readFile(file, 'utf8')) as { clips?: Record<string, unknown> }
  if (!manifest.clips || typeof manifest.clips !== 'object') throw new MarketPackageError('Pet pack has no clips')
  for (const [name, clip] of Object.entries(clips)) {
    if (manifest.clips[name]) throw new MarketPackageError(`Pet clip already exists: ${name}`)
    manifest.clips[name] = clip
  }
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function removeClipDefinitions(petDirectory: string, names: string[]): Promise<void> {
  const file = path.join(petDirectory, 'pet-pack.json')
  const manifest = JSON.parse(await fs.readFile(file, 'utf8')) as {
    clips?: Record<string, unknown>
    agentStateMapping?: Record<string, unknown>
    defaultAnimation?: string
  }
  if (!manifest.clips || typeof manifest.clips !== 'object') throw new MarketPackageError('Pet pack has no clips')
  for (const name of names) {
    delete manifest.clips[name]
    await fs.rm(path.join(petDirectory, 'clips', name), { recursive: true, force: true })
  }
  if (manifest.agentStateMapping && typeof manifest.agentStateMapping === 'object') {
    for (const [state, clip] of Object.entries(manifest.agentStateMapping)) {
      if (typeof clip === 'string' && names.includes(clip)) delete manifest.agentStateMapping[state]
    }
  }
  if (manifest.defaultAnimation && names.includes(manifest.defaultAnimation)) manifest.defaultAnimation = 'idle'
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function mergeClipDirectory(fromRoot: string, intoRoot: string): Promise<void> {
  const source = path.join(fromRoot, 'clips')
  const destination = path.join(intoRoot, 'clips')
  await fs.mkdir(destination, { recursive: true })
  const entries = await fs.readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[\w][\w.-]*$/.test(entry.name)) {
      throw new MarketPackageError(`Pet part clip "${entry.name}" is not a directory`)
    }
    const target = path.join(destination, entry.name)
    try {
      await fs.access(target)
      throw new MarketPackageError(`Pet clip already exists: ${entry.name}`)
    } catch (error) {
      if (error instanceof MarketPackageError || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await fs.cp(path.join(source, entry.name), target, { recursive: true, verbatimSymlinks: false })
  }
}

async function rejectScripts(packageRoot: string): Promise<void> {
  const raw = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
    name?: string
  }
  if (!parseMarketPackageName(raw.name ?? '')) throw new MarketPackageError('Packed name is not an official market package')
  const scripts = Object.values(raw.scripts ?? {}).filter((command) => command.trim())
  if (scripts.length) throw new MarketPackageError('Package install scripts are not allowed')
}

async function assertDeclaredAssets(root: string, manifest: ThemePackManifest): Promise<void> {
  const files = new Set<string>([manifest.preview])
  for (const variant of manifest.variants) {
    if (variant.portraitAsset) files.add(variant.portraitAsset)
    for (const file of Object.values(variant.cssImages ?? {})) files.add(file)
  }
  for (const file of Object.values(manifest.startup ?? {})) files.add(file)
  for (const file of files) {
    const resolved = path.resolve(root, file)
    if (!resolved.startsWith(path.resolve(root) + path.sep)) {
      throw new MarketPackageError(`Theme asset escapes the package: ${file}`)
    }
    const stat = await fs.stat(resolved)
    if (!stat.isFile()) throw new MarketPackageError(`Theme asset is missing: ${file}`)
  }
}

export async function themeManifestAt(root: string, packId: string): Promise<ThemePackManifest | null> {
  try {
    return validateThemePackManifest(
      JSON.parse(await fs.readFile(path.join(root, 'themes', packId, 'theme-pack.json'), 'utf8'))
    )
  } catch {
    return null
  }
}
