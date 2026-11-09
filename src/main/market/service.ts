import path from 'node:path'
import semver from 'semver'
import { OFFICIAL_REGISTRY } from '@shared/market/package-name'
import type {
  MarketInstalled,
  MarketInstallResult,
  MarketProgress,
  MarketSearchResult
} from '@shared/market/types'
import { MarketInstaller, type PetDirectoryInstaller } from './installer'
import { installMarketProtocol } from './protocol'
import { MarketRegistryClient, type RegistryVersion } from './registry-client'
import { themeManifestAt } from './installer'

export interface MarketServiceOptions {
  userData: string
  petRoot: string
  appVersion: string
  pets: PetDirectoryInstaller & { remove(id: string): Promise<void> }
  fetcher?: typeof fetch
  registry?: string
  onProgress?: (progress: MarketProgress) => void
}

export class MarketService {
  private readonly client: MarketRegistryClient
  private readonly installer: MarketInstaller
  readonly root: string

  constructor(private readonly options: MarketServiceOptions) {
    this.root = path.join(options.userData, 'market')
    this.client = new MarketRegistryClient(options.fetcher ?? fetch, options.registry ?? OFFICIAL_REGISTRY)
    this.installer = new MarketInstaller({
      root: this.root,
      appVersion: options.appVersion,
      client: this.client,
      fetcher: options.fetcher,
      pets: options.pets,
      onProgress: options.onProgress
    })
  }

  start(): void {
    installMarketProtocol(path.join(this.root, 'themes'), this.options.petRoot)
  }

  async search(query: string, kind: 'all' | 'theme' | 'pet', refresh = false): Promise<MarketSearchResult> {
    const result = await this.client.search(query, kind, refresh).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      if (!/timeout|network|fetch|ECONN|ENOTFOUND|HTTP/i.test(message)) throw error
      return { packages: [], incomplete: false, fromCache: false, offline: true }
    })
    if (result.offline || result.packages.length === 0) return result
    const packages = (
      await Promise.all(result.packages.map((item) => this.detailSummary(item)))
    ).filter((item): item is MarketSearchResult['packages'][number] => item !== null)
    return { ...result, packages }
  }

  private async detailSummary(item: MarketSearchResult['packages'][number]) {
    try {
      const meta = await this.client.package(item.name)
      const version =
        meta.versions.find(
          (entry) => entry.version === meta.distTags.latest && !entry.deprecated && entry.scripts.length === 0
        ) ?? meta.versions.find((entry) => !entry.deprecated && entry.scripts.length === 0)
      if (!version || version.partOf) return null
      const coerced = semver.coerce(this.options.appVersion)
      return {
        ...item,
        version: version.version,
        description: meta.description || item.description,
        author: meta.author || item.author,
        license: version.license || meta.license,
        unpackedSize: await this.unpackedSize(item.name, version),
        deprecated: version.deprecated,
        compatible: Boolean(
          version.compatible && coerced && semver.satisfies(coerced, version.compatible, { includePrerelease: true })
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/Refusing|unofficial/.test(message)) return null
      return item
    }
  }

  private async unpackedSize(name: string, version: RegistryVersion): Promise<number | null> {
    if (version.unpackedSize === null) return null
    let total = version.unpackedSize
    for (const partName of version.parts) {
      const metadata = await this.client.package(partName)
      const part = metadata.versions.find(
        (entry) => entry.version === version.version && !entry.deprecated && entry.scripts.length === 0
      )
      if (!part || part.partOf !== name || part.unpackedSize === null) return version.unpackedSize
      total += part.unpackedSize
    }
    return total
  }

  async installed(): Promise<MarketInstalled> {
    const index = await this.installer.readIndex()
    const themes = await Promise.all(
      Object.values(index.themes).map(async (record) => {
        const manifest = await themeManifestAt(this.root, record.packId)
        return {
          name: record.name,
          kind: 'theme' as const,
          version: record.version,
          packId: record.packId,
          license: record.license,
          latest: null,
          updateAvailable: false,
          manifest,
          petId: null
        }
      })
    )
    const pets = Object.values(index.pets).map((record) => ({
      name: record.name,
      kind: 'pet' as const,
      version: record.version,
      packId: record.packId,
      license: record.license,
      latest: null,
      updateAvailable: false,
      manifest: null,
      petId: record.packId
    }))
    return { themes, pets }
  }

  async refreshLatest(): Promise<MarketInstalled> {
    const current = await this.installed()
    const fill = async <T extends MarketInstalled['themes'][number]>(item: T): Promise<T> => {
      try {
        const metadata = await this.client.package(item.name)
        const latest = metadata.distTags['latest'] ?? metadata.versions[0]?.version ?? null
        return {
          ...item,
          latest,
          updateAvailable: Boolean(latest && semver.gt(latest, item.version))
        }
      } catch {
        return item
      }
    }
    return {
      themes: await Promise.all(current.themes.map(fill)),
      pets: await Promise.all(current.pets.map(fill))
    }
  }

  install(name: string, version?: string): Promise<MarketInstallResult> {
    return this.installer.install(name, version)
  }

  async uninstall(name: string): Promise<void> {
    const index = await this.installer.readIndex()
    const pet = Object.values(index.pets).find((record) => record.name === name)
    if (pet) {
      await this.options.pets.remove(pet.packId)
      await this.installer.removeByPackageName(name)
      return
    }
    await this.installer.removeByPackageName(name)
  }

  cancel(name: string): void {
    this.installer.cancel(name)
  }
}
