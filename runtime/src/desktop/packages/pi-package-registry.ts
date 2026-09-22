// @ts-nocheck
import semver from 'semver'
import type {
  PiPackageInfo,
  PiPackageSearchInput,
  PiPackageSearchResult,
  PiPackageUpdateInfo,
  PiRegistryPackage,
  PiRegistryPackageDetail,
  PiRegistryPackageResources,
  PiRegistryPackageType
} from '../../vendor/shared/ipc/api-types.js'
import { NetworkError, NotFoundError, ValidationError } from '../services/errors.js'

const SEARCH_URL = 'https://registry.npmjs.org/-/v1/search'
const REGISTRY_URL = 'https://registry.npmjs.org'
const DOWNLOADS_URL = 'https://api.npmjs.org/downloads/range/last-month'
const SEARCH_TTL_MS = 45_000
const DETAIL_TTL_MS = 30 * 60_000
const REQUEST_TIMEOUT_MS = 15_000
const DETAIL_CONCURRENCY = 8
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i

type RegistryFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>

interface CacheEntry<T> {
  expiresAt: number
  value: T
}

interface RegistrySearchResponse {
  total?: unknown
  objects?: unknown
}

interface RegistryManifest extends Record<string, unknown> {
  name?: unknown
  version?: unknown
  description?: unknown
  keywords?: unknown
  publisher?: unknown
  author?: unknown
  maintainers?: unknown
  license?: unknown
  homepage?: unknown
  repository?: unknown
  dependencies?: unknown
  peerDependencies?: unknown
  dist?: unknown
  pi?: unknown
}

interface RegistryPackument extends Record<string, unknown> {
  'dist-tags'?: unknown
  versions?: unknown
}

interface RegistrySearchPackage extends RegistryManifest {
  date?: unknown
  links?: unknown
}

export interface PiPackageRegistryOptions {
  fetch?: RegistryFetcher
  now?: () => number
  searchUrl?: string
  registryUrl?: string
  downloadsUrl?: string
  searchTtlMs?: number
  detailTtlMs?: number
  concurrency?: number
}

export class PiPackageRegistry {
  private readonly fetcher: RegistryFetcher
  private readonly now: () => number
  private readonly searchUrl: string
  private readonly registryUrl: string
  private readonly downloadsUrl: string
  private readonly searchTtlMs: number
  private readonly detailTtlMs: number
  private readonly concurrency: number
  private readonly searchCache = new Map<string, CacheEntry<PiPackageSearchResult>>()
  private readonly manifestCache = new Map<string, CacheEntry<RegistryManifest>>()
  private readonly detailCache = new Map<string, CacheEntry<PiRegistryPackageDetail>>()
  private readonly packumentCache = new Map<string, CacheEntry<RegistryPackument>>()
  private readonly downloadsCache = new Map<
    string,
    CacheEntry<{ monthly: number | null; weekly: number | null }>
  >()

  constructor(options: PiPackageRegistryOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.searchUrl = options.searchUrl ?? SEARCH_URL
    this.registryUrl = trimTrailingSlash(options.registryUrl ?? REGISTRY_URL)
    this.downloadsUrl = trimTrailingSlash(options.downloadsUrl ?? DOWNLOADS_URL)
    this.searchTtlMs = options.searchTtlMs ?? SEARCH_TTL_MS
    this.detailTtlMs = options.detailTtlMs ?? DETAIL_TTL_MS
    this.concurrency = Math.min(8, Math.max(6, options.concurrency ?? DETAIL_CONCURRENCY))
  }

  async searchPackages(input: PiPackageSearchInput = {}): Promise<PiPackageSearchResult> {
    const page = clampInteger(input.page, 1, Number.MAX_SAFE_INTEGER, 1)
    const pageSize = clampInteger(input.pageSize, 1, 50, 50)
    const query = input.query?.trim().slice(0, 200) ?? ''
    const type = input.type ?? 'all'
    const sort = input.sort ?? 'relevance'
    const refresh = input.refresh === true
    const cacheKey = JSON.stringify({ page, pageSize, query, type, sort })
    const cached = this.readCache(this.searchCache, cacheKey)
    if (cached && !refresh) return cached

    const url = new URL(this.searchUrl)
    url.searchParams.set('text', `keywords:pi-package${query ? ` ${query}` : ''}`)
    url.searchParams.set('size', String(pageSize))
    url.searchParams.set('from', String((page - 1) * pageSize))
    const payload = await this.fetchJson<RegistrySearchResponse>(url)
    const total = typeof payload.total === 'number' && payload.total >= 0 ? payload.total : 0
    const rawObjects = Array.isArray(payload.objects) ? payload.objects : []
    const basicItems = rawObjects
      .map((entry) => this.fromSearchObject(entry))
      .filter((entry): entry is PiRegistryPackage => entry !== null)

    const enriched = await promisePool(basicItems, this.concurrency, async (item) => {
      try {
        const manifest = await this.getPackageManifest(item.name, item.version, refresh)
        const downloads = await this.getPackageDownloads(item.name, refresh).catch(() => ({
          monthly: null,
          weekly: null
        }))
        return this.mergeManifest(item, manifest, downloads)
      } catch (error) {
        return {
          ...item,
          detailStatus: 'failed' as const,
          detailError: error instanceof Error ? error.message : String(error)
        }
      }
    })
    const filtered =
      type === 'all' ? enriched : enriched.filter((item) => item.types.includes(type))
    const items = sortPackages(filtered, sort)
    const result: PiPackageSearchResult = {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      fetchedAt: this.now()
    }
    this.writeCache(this.searchCache, cacheKey, result, this.searchTtlMs)
    return result
  }

  async getPackageDetail(name: string, refresh = false): Promise<PiRegistryPackageDetail> {
    const packageName = validatePackageName(name)
    const packument = await this.getPackument(packageName, refresh)
    const latestVersion = latestFromPackument(packument)
    if (!latestVersion) throw new NotFoundError(`Latest version not found for ${packageName}`)
    const cacheKey = `${packageName}@${latestVersion}`
    const cached = this.readCache(this.detailCache, cacheKey)
    if (cached && !refresh) return cached

    const versions = recordValue(packument.versions)
    const manifest = recordValue(versions[latestVersion]) as RegistryManifest
    if (!Object.keys(manifest).length) {
      throw new NotFoundError(`Version ${latestVersion} not found for ${packageName}`)
    }
    const downloads = await this.getPackageDownloads(packageName, refresh).catch(() => ({
      monthly: null,
      weekly: null
    }))
    const basic = basePackage(manifest, packageName, latestVersion)
    basic.publishDate = stringValue(recordValue(packument.time)[latestVersion]) || null
    const enriched = this.mergeManifest(basic, manifest, downloads)
    const detail = toPackageDetail(enriched, manifest, latestVersion)
    this.writeCache(this.detailCache, cacheKey, detail, this.detailTtlMs)
    this.writeCache(this.manifestCache, cacheKey, manifest, this.detailTtlMs)
    return detail
  }

  async getPackageManifest(
    name: string,
    version?: string,
    refresh = false
  ): Promise<RegistryManifest> {
    const packageName = validatePackageName(name)
    const packageVersion = version?.trim() || (await this.getLatestVersion(packageName, refresh))
    const cacheKey = `${packageName}@${packageVersion}`
    const cached = this.readCache(this.manifestCache, cacheKey)
    if (cached && !refresh) return cached
    const url = `${this.registryUrl}/${encodeURIComponent(packageName)}/${encodeURIComponent(packageVersion)}`
    const manifest = await this.fetchJson<RegistryManifest>(url)
    this.writeCache(this.manifestCache, cacheKey, manifest, this.detailTtlMs)
    return manifest
  }

  async getLatestVersion(name: string, refresh = false): Promise<string> {
    const packageName = validatePackageName(name)
    const packument = await this.getPackument(packageName, refresh)
    const latest = latestFromPackument(packument)
    if (!latest) throw new NotFoundError(`Latest version not found for ${packageName}`)
    return latest
  }

  inferPackageTypes(piManifest: unknown): PiRegistryPackageType[] {
    const pi = recordValue(piManifest)
    const types: PiRegistryPackageType[] = []
    if (resourceValues(pi.extensions).length) types.push('extension')
    if (resourceValues(pi.skills).length) types.push('skill')
    if (resourceValues(pi.prompts).length) types.push('prompt')
    if (resourceValues(pi.themes).length) types.push('theme')
    return types.length ? types : ['package']
  }

  async checkInstalledPackageUpdate(pkg: PiPackageInfo): Promise<PiPackageUpdateInfo> {
    const base = {
      packageId: pkg.id,
      source: pkg.source,
      scope: pkg.scope,
      installedVersion: pkg.version
    }
    if (pkg.sourceType !== 'npm' || !pkg.registered) {
      return {
        ...base,
        latestVersion: null,
        updateAvailable: false,
        state: 'not-applicable',
        error: null
      }
    }
    const source = npmSource(pkg.source)
    if (!source) {
      return {
        ...base,
        latestVersion: null,
        updateAvailable: false,
        state: 'check-failed',
        error: 'Invalid npm package source'
      }
    }
    if (source.fixedVersion) {
      return {
        ...base,
        latestVersion: source.fixedVersion,
        updateAvailable: false,
        state: 'fixed-version',
        error: null
      }
    }
    try {
      const latestVersion = await this.getLatestVersion(source.name)
      const updateAvailable = Boolean(
        pkg.version && semver.valid(pkg.version) && semver.valid(latestVersion)
          ? semver.gt(latestVersion, pkg.version)
          : false
      )
      return {
        ...base,
        latestVersion,
        updateAvailable,
        state: updateAvailable ? 'update-available' : 'up-to-date',
        error: null
      }
    } catch (error) {
      return {
        ...base,
        latestVersion: null,
        updateAvailable: false,
        state: 'check-failed',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async checkInstalledPackageUpdates(packages: PiPackageInfo[]): Promise<PiPackageUpdateInfo[]> {
    return promisePool(packages, this.concurrency, (pkg) => this.checkInstalledPackageUpdate(pkg))
  }

  async getPackageDownloads(
    name: string,
    refresh = false
  ): Promise<{ monthly: number | null; weekly: number | null }> {
    const packageName = validatePackageName(name)
    const cached = this.readCache(this.downloadsCache, packageName)
    if (cached && !refresh) return cached
    const url = `${this.downloadsUrl}/${encodeURIComponent(packageName)}`
    const payload = await this.fetchJson<{ downloads?: unknown }>(url)
    const days = Array.isArray(payload.downloads) ? payload.downloads : []
    const values = days.map((day) => numberValue(recordValue(day).downloads)).filter(isNumber)
    const result = {
      monthly: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
      weekly: values.length ? values.slice(-7).reduce((sum, value) => sum + value, 0) : null
    }
    this.writeCache(this.downloadsCache, packageName, result, this.searchTtlMs)
    return result
  }

  private async getPackument(name: string, refresh: boolean): Promise<RegistryPackument> {
    const cached = this.readCache(this.packumentCache, name)
    if (cached && !refresh) return cached
    const url = `${this.registryUrl}/${encodeURIComponent(name)}`
    const packument = await this.fetchJson<RegistryPackument>(url)
    this.writeCache(this.packumentCache, name, packument, this.detailTtlMs)
    return packument
  }

  private fromSearchObject(value: unknown): PiRegistryPackage | null {
    const pkg = recordValue(recordValue(value).package) as RegistrySearchPackage
    const name = stringValue(pkg.name)
    const version = stringValue(pkg.version)
    if (!name || !version || !PACKAGE_NAME_PATTERN.test(name)) return null
    return basePackage(pkg, name, version)
  }

  private mergeManifest(
    pkg: PiRegistryPackage,
    manifest: RegistryManifest,
    downloads: { monthly: number | null; weekly: number | null }
  ): PiRegistryPackage {
    const resources = packageResources(manifest.pi)
    return {
      ...pkg,
      description: stringValue(manifest.description) || pkg.description,
      keywords: stringList(manifest.keywords).length ? stringList(manifest.keywords) : pkg.keywords,
      author: personName(manifest.author) || pkg.author,
      maintainers: personNames(manifest.maintainers).length
        ? personNames(manifest.maintainers)
        : pkg.maintainers,
      license: stringValue(manifest.license) || pkg.license,
      homepage: stringValue(manifest.homepage) || pkg.homepage,
      repository: repositoryUrl(manifest.repository) || pkg.repository,
      monthlyDownloads: downloads.monthly,
      weeklyDownloads: downloads.weekly,
      types: this.inferPackageTypes(manifest.pi),
      resources,
      detailStatus: 'loaded',
      detailError: null
    }
  }

  private async fetchJson<T>(input: string | URL): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetcher(input, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      })
      if (response.status === 404) throw new NotFoundError('Registry package was not found')
      if (!response.ok) {
        throw new NetworkError(`Registry request failed (${response.status})`, {
          status: response.status,
          retryAfter: response.headers.get('retry-after')
        })
      }
      try {
        return (await response.json()) as T
      } catch (error) {
        throw new NetworkError('Registry returned invalid JSON', {
          cause: error instanceof Error ? error.message : String(error)
        })
      }
    } catch (error) {
      if (error instanceof NetworkError || error instanceof NotFoundError) throw error
      throw new NetworkError(
        error instanceof Error && error.name === 'AbortError'
          ? 'Registry request timed out'
          : 'Registry request failed',
        { cause: error instanceof Error ? error.message : String(error) }
      )
    } finally {
      clearTimeout(timer)
    }
  }

  private readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = cache.get(key)
    if (!entry || entry.expiresAt <= this.now()) {
      if (entry) cache.delete(key)
      return null
    }
    return entry.value
  }

  private writeCache<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    value: T,
    ttl: number
  ): void {
    cache.set(key, { value, expiresAt: this.now() + ttl })
  }
}

function basePackage(
  manifest: RegistrySearchPackage | RegistryManifest,
  name: string,
  version: string
): PiRegistryPackage {
  const links = recordValue((manifest as RegistrySearchPackage).links)
  const publisher = personName(manifest.publisher)
  return {
    name,
    version,
    description: stringValue(manifest.description),
    keywords: stringList(manifest.keywords),
    publisher,
    author: personName(manifest.author),
    maintainers: personNames(manifest.maintainers),
    license: stringValue(manifest.license),
    homepage: stringValue(links.homepage) || stringValue(manifest.homepage) || null,
    repository: stringValue(links.repository) || repositoryUrl(manifest.repository),
    npmUrl: stringValue(links.npm) || `https://www.npmjs.com/package/${encodeURIComponent(name)}`,
    publishDate: stringValue((manifest as RegistrySearchPackage).date) || null,
    monthlyDownloads: null,
    weeklyDownloads: null,
    types: ['package'],
    resources: emptyResources(),
    detailStatus: 'loaded',
    detailError: null
  }
}

function toPackageDetail(
  pkg: PiRegistryPackage,
  manifest: RegistryManifest,
  latestVersion: string
): PiRegistryPackageDetail {
  const dist = recordValue(manifest.dist)
  return {
    ...pkg,
    latestVersion,
    dependencies: stringRecord(manifest.dependencies),
    peerDependencies: stringRecord(manifest.peerDependencies),
    dist: {
      tarball: stringValue(dist.tarball) || null,
      shasum: stringValue(dist.shasum) || null,
      integrity: stringValue(dist.integrity) || null,
      unpackedSize: numberValue(dist.unpackedSize)
    },
    piManifest: Object.keys(recordValue(manifest.pi)).length ? recordValue(manifest.pi) : null
  }
}

function packageResources(value: unknown): PiRegistryPackageResources {
  const pi = recordValue(value)
  return {
    extensions: resourceValues(pi.extensions),
    skills: resourceValues(pi.skills),
    prompts: resourceValues(pi.prompts),
    themes: resourceValues(pi.themes)
  }
}

function emptyResources(): PiRegistryPackageResources {
  return { extensions: [], skills: [], prompts: [], themes: [] }
}

function resourceValues(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        typeof entry === 'string'
          ? entry
          : stringValue(recordValue(entry).path || recordValue(entry).name)
      )
      .filter(Boolean)
  }
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>)
  return []
}

function latestFromPackument(packument: RegistryPackument): string {
  return stringValue(recordValue(packument['dist-tags']).latest)
}

function npmSource(source: string): { name: string; fixedVersion: string | null } | null {
  if (!source.startsWith('npm:')) return null
  const raw = source.slice(4)
  const separator = raw.lastIndexOf('@')
  const scopedPrefix = raw.startsWith('@') ? raw.indexOf('/') : -1
  const hasVersion = separator > Math.max(0, scopedPrefix)
  const name = hasVersion ? raw.slice(0, separator) : raw
  if (!PACKAGE_NAME_PATTERN.test(name)) return null
  return { name, fixedVersion: hasVersion ? raw.slice(separator + 1) || null : null }
}

function sortPackages(items: PiRegistryPackage[], sort: PiPackageSearchInput['sort']) {
  if (sort === 'downloads') {
    return [...items].sort((a, b) => (b.monthlyDownloads ?? -1) - (a.monthlyDownloads ?? -1))
  }
  if (sort === 'published') {
    return [...items].sort(
      (a, b) => Date.parse(b.publishDate ?? '') - Date.parse(a.publishDate ?? '')
    )
  }
  return items
}

async function promisePool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
}

function validatePackageName(name: string): string {
  const value = name.trim()
  if (!PACKAGE_NAME_PATTERN.test(value)) throw new ValidationError('Invalid npm package name')
  return value
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isNumber(value: number | null): value is number {
  return value !== null
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[ ,]+/).filter(Boolean)
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(recordValue(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

function personName(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const person = recordValue(value)
  return stringValue(person.name) || stringValue(person.username) || stringValue(person.email)
}

function personNames(value: unknown): string[] {
  return Array.isArray(value) ? value.map(personName).filter(Boolean) : []
}

function repositoryUrl(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  return stringValue(recordValue(value).url) || null
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
