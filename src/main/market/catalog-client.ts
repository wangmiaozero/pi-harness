import fs from 'node:fs/promises'
import path from 'node:path'
import semver from 'semver'
import {
  OFFICIAL_CATALOG_URL,
  OFFICIAL_RELEASE_PREFIX,
  parseMarketCatalog,
  type CatalogPackage,
  type MarketCatalog
} from '@shared/market/catalog'
import { parseMarketPackageName } from '@shared/market/package-name'
import type { MarketPackageSummary, MarketSearchResult } from '@shared/market/types'
import { MARKET_LIMITS } from './limits'

const RELEASE_HOSTS = new Set([
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com'
])

interface StoredCatalog {
  schemaVersion: 1
  fetchedAt: number
  catalog: MarketCatalog
}

export class MarketCatalogClient {
  private memory: StoredCatalog | null = null

  constructor(
    private readonly options: {
      appVersion: string
      fetcher?: typeof fetch
      catalogUrl?: string
      cacheFile?: string
      ttlMs?: number
      now?: () => number
    }
  ) {
    const catalogUrl = this.catalogUrl
    if (catalogUrl !== OFFICIAL_CATALOG_URL && !/^http:\/\/127\.0\.0\.1:\d+\/catalog\.json$/.test(catalogUrl)) {
      throw new Error('Market catalog must be the official GitHub catalog')
    }
  }

  get catalogUrl(): string {
    return this.options.catalogUrl ?? OFFICIAL_CATALOG_URL
  }

  async search(query: string, kind: 'all' | 'theme' | 'pet', refresh = false): Promise<MarketSearchResult> {
    const loaded = await this.load(refresh)
    const text = query.trim().toLowerCase()
    const byName = new Map(loaded.catalog.packages.map((item) => [item.name, item]))
    const packages = loaded.catalog.packages
      .filter((item) => kind === 'all' || item.kind === kind)
      .filter((item) => !text || item.name.toLowerCase().includes(text) || item.description.toLowerCase().includes(text))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => this.summary(item, byName))
    return { packages, incomplete: false, fromCache: loaded.fromCache, offline: loaded.offline }
  }

  async package(name: string): Promise<CatalogPackage> {
    if (!parseMarketPackageName(name)) throw new Error(`Refusing unofficial package: ${name}`)
    const loaded = await this.load(false)
    const found = loaded.catalog.packages.find((item) => item.name === name)
    if (!found) throw new Error(`Package is not published: ${name}`)
    this.assertInstallable(found)
    return found
  }

  assertInstallable(pack: CatalogPackage): void {
    const coerced = semver.coerce(this.options.appVersion)
    if (!coerced || !semver.satisfies(coerced, pack.compatible, { includePrerelease: true })) {
      throw new Error(`No compatible version of ${pack.name}`)
    }
    if (pack.compressedSize > MARKET_LIMITS.maxTarballBytes) throw new Error('Package archive exceeds the size limit')
    if (pack.unpackedSize > MARKET_LIMITS.maxUnpackedBytes) throw new Error('Package unpack size exceeds the limit')
    this.assertAssetUrl(pack.downloadUrl)
    if (pack.previewUrl) this.assertAssetUrl(pack.previewUrl)
  }

  assertAssetUrl(assetUrl: string): void {
    this.assertHop(assetUrl, true)
  }

  assertRedirect(assetUrl: string): void {
    this.assertHop(assetUrl, false)
  }

  private assertHop(assetUrl: string, initial: boolean): void {
    let url: URL
    try {
      url = new URL(assetUrl)
    } catch {
      throw new Error('Download URL is not an official GitHub release')
    }
    if (url.username || url.password || assetUrl.includes('\\') || assetUrl.includes('..')) {
      throw new Error('Download URL is not an official GitHub release')
    }
    const catalog = new URL(this.catalogUrl)
    if (catalog.hostname === '127.0.0.1') {
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== catalog.port) {
        throw new Error('Download URL is not an official GitHub release')
      }
      return
    }
    if (url.protocol !== 'https:') throw new Error('Download URL is not an official GitHub release')
    if (url.hostname === 'github.com') {
      if (!assetUrl.startsWith(OFFICIAL_RELEASE_PREFIX)) throw new Error('Download URL is not an official GitHub release')
      return
    }
    if (!initial && RELEASE_HOSTS.has(url.hostname)) return
    throw new Error('Download URL is not an official GitHub release')
  }

  private summary(pack: CatalogPackage, byName: Map<string, CatalogPackage>): MarketPackageSummary {
    const coerced = semver.coerce(this.options.appVersion)
    let unpackedSize = pack.unpackedSize
    for (const partName of pack.parts) unpackedSize += byName.get(partName)?.unpackedSize ?? 0
    return {
      name: pack.name,
      kind: pack.kind,
      version: pack.version,
      description: pack.description,
      author: pack.author,
      license: pack.license,
      unpackedSize,
      deprecated: false,
      compatible: Boolean(coerced && semver.satisfies(coerced, pack.compatible, { includePrerelease: true }))
    }
  }

  private async load(refresh: boolean): Promise<{ catalog: MarketCatalog; fromCache: boolean; offline: boolean }> {
    const now = this.options.now?.() ?? Date.now()
    const ttl = this.options.ttlMs ?? MARKET_LIMITS.cacheTtlMs
    if (!refresh && this.memory && now - this.memory.fetchedAt < ttl) {
      return { catalog: this.memory.catalog, fromCache: true, offline: false }
    }
    const stored = this.memory ?? (await this.readCache())
    if (!refresh && stored && now - stored.fetchedAt < ttl) {
      this.memory = stored
      return { catalog: stored.catalog, fromCache: true, offline: false }
    }
    try {
      const catalog = await this.fetchCatalog()
      const next = { schemaVersion: 1 as const, fetchedAt: now, catalog }
      this.memory = next
      await this.writeCache(next)
      return { catalog, fromCache: false, offline: false }
    } catch (error) {
      if (error instanceof Error && /^Market catalog (is invalid|package|is missing|lists|part)/.test(error.message)) {
        throw error
      }
      if (stored) {
        this.memory = stored
        return { catalog: stored.catalog, fromCache: true, offline: true }
      }
      return { catalog: { schemaVersion: 1, packages: [] }, fromCache: false, offline: true }
    }
  }

  private async fetchCatalog(): Promise<MarketCatalog> {
    const fetcher = this.options.fetcher ?? fetch
    let current = this.catalogUrl
    let response: Response | null = null
    for (let hop = 0; hop < 5; hop += 1) {
      this.assertCatalogHop(current)
      response = await fetcher(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(MARKET_LIMITS.requestTimeoutMs)
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) throw new Error('Market catalog redirect is invalid')
        current = new URL(location, current).href
        continue
      }
      break
    }
    if (!response || response.status >= 300) throw new Error(`Market catalog failed: HTTP ${response?.status ?? 0}`)
    if (!response.ok) throw new Error(`Market catalog failed: HTTP ${response.status}`)
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new Error('Market catalog is invalid')
    }
    const catalog = parseMarketCatalog(body)
    for (const item of catalog.packages) {
      try {
        this.assertAssetUrl(item.downloadUrl)
        if (item.previewUrl) this.assertAssetUrl(item.previewUrl)
      } catch {
        throw new Error('Market catalog is invalid')
      }
    }
    return catalog
  }

  private assertCatalogHop(value: string): void {
    const url = new URL(value)
    const catalog = new URL(this.catalogUrl)
    if (catalog.hostname === '127.0.0.1') {
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== catalog.port) {
        throw new Error('Market catalog must be the official GitHub catalog')
      }
      return
    }
    if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com') {
      throw new Error('Market catalog must be the official GitHub catalog')
    }
    if (url.pathname !== '/wangmiaozero/pi-Harness-packages/market-index/catalog.json') {
      throw new Error('Market catalog must be the official GitHub catalog')
    }
  }

  private async readCache(): Promise<StoredCatalog | null> {
    if (!this.options.cacheFile) return null
    try {
      const raw = JSON.parse(await fs.readFile(this.options.cacheFile, 'utf8')) as StoredCatalog
      if (raw.schemaVersion !== 1 || typeof raw.fetchedAt !== 'number') return null
      return { schemaVersion: 1, fetchedAt: raw.fetchedAt, catalog: parseMarketCatalog(raw.catalog) }
    } catch {
      return null
    }
  }

  private async writeCache(stored: StoredCatalog): Promise<void> {
    if (!this.options.cacheFile) return
    await fs.mkdir(path.dirname(this.options.cacheFile), { recursive: true })
    const temporary = `${this.options.cacheFile}.tmp`
    await fs.writeFile(temporary, JSON.stringify(stored))
    await fs.rename(temporary, this.options.cacheFile)
  }
}
