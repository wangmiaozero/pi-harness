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

interface MarketIndex {
  themes: Record<string, IndexRecord>
  pets: Record<string, IndexRecord>
}

export class MarketInstaller {
  private readonly jobs = new Map<string, AbortController>()
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly options: MarketInstallerOptions) {}

  async install(name: string, version?: string): Promise<MarketInstallResult> {
    const parsed = parseMarketPackageName(name)
    if (!parsed) throw new MarketPackageError(`Refusing unofficial package: ${name}`)
    if (this.jobs.has(name)) throw new MarketPackageError(`Package is already installing: ${name}`)
    await this.acquire()
    const controller = new AbortController()
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
      this.jobs.delete(name)
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
      this.release()
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
        pets: raw.pets ?? {}
      }
    } catch {
      return { themes: {}, pets: {} }
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
    const pet = Object.entries(index.pets).find(([, record]) => record.name === name)
    if (!pet) throw new MarketPackageError(`Package is not installed: ${name}`)
    delete index.pets[pet[0]]
    await this.writeIndex(index)
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
