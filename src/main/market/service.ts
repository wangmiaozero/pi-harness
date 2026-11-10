import path from 'node:path'
import semver from 'semver'
import type {
  MarketInstalled,
  MarketInstallResult,
  MarketProgress,
  MarketSearchResult
} from '@shared/market/types'
import { MarketInstaller, themeManifestAt, type PetDirectoryInstaller } from './installer'
import { installMarketProtocol } from './protocol'
import { MarketCatalogClient } from './catalog-client'

export interface MarketServiceOptions {
  userData: string
  petRoot: string
  appVersion: string
  pets: PetDirectoryInstaller & { remove(id: string): Promise<void> }
  fetcher?: typeof fetch
  catalogUrl?: string
  catalogTtlMs?: number
  onProgress?: (progress: MarketProgress) => void
}

export class MarketService {
  private readonly client: MarketCatalogClient
  private readonly installer: MarketInstaller
  readonly root: string

  constructor(private readonly options: MarketServiceOptions) {
    this.root = path.join(options.userData, 'market')
    this.client = new MarketCatalogClient({
      appVersion: options.appVersion,
      fetcher: options.fetcher,
      catalogUrl: options.catalogUrl,
      cacheFile: path.join(this.root, 'catalog-cache.json'),
      ttlMs: options.catalogTtlMs
    })
    this.installer = new MarketInstaller({
      root: this.root,
      petRoot: options.petRoot,
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
    return this.client.search(query, kind, refresh)
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
    const addons = Object.values(index.addons).map((record) => ({
      name: record.name,
      kind: 'pet' as const,
      version: record.version,
      packId: record.packId,
      license: record.license,
      latest: null,
      updateAvailable: false,
      manifest: null,
      petId: null
    }))
    return { themes, pets: [...pets, ...addons] }
  }

  async refreshLatest(): Promise<MarketInstalled> {
    const current = await this.installed()
    const fill = async <T extends MarketInstalled['themes'][number]>(item: T): Promise<T> => {
      try {
        const metadata = await this.client.package(item.name)
        const latest = metadata.version
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
    if (index.addons[name]) {
      await this.installer.removeAddon(name)
      return
    }
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
