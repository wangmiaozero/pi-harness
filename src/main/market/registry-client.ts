import { OFFICIAL_REGISTRY, parseMarketPackageName } from '@shared/market/package-name'
import type { MarketPackageSummary, MarketSearchResult } from '@shared/market/types'
import semver from 'semver'
import { MARKET_LIMITS } from './limits'

export interface RegistryVersion {
  version: string
  deprecated: boolean
  integrity: string
  tarball: string
  unpackedSize: number | null
  tarballSize: number | null
  license: string
  compatible: string | null
  scripts: string[]
}

export interface RegistryPackage {
  name: string
  description: string
  author: string
  license: string
  distTags: Record<string, string>
  versions: RegistryVersion[]
}

interface CacheEntry {
  at: number
  key: string
  result: MarketSearchResult
}

export class MarketRegistryClient {
  private cache: CacheEntry | null = null
  private readonly packageCache = new Map<string, { at: number; value: RegistryPackage }>()

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly registry = OFFICIAL_REGISTRY
  ) {
    if (registry !== OFFICIAL_REGISTRY && !/^http:\/\/127\.0\.0\.1:\d+$/.test(registry)) {
      throw new Error('Market registry must be the official npm registry')
    }
  }

  async search(query: string, kind: 'all' | 'theme' | 'pet', refresh = false): Promise<MarketSearchResult> {
    const text = ['scope:pi-harness', query.trim()].filter(Boolean).join(' ')
    const key = `${kind}\n${text}`
    if (
      !refresh &&
      this.cache &&
      this.cache.key === key &&
      Date.now() - this.cache.at < MARKET_LIMITS.cacheTtlMs
    ) {
      return { ...this.cache.result, fromCache: true }
    }
    const packages = new Map<string, MarketPackageSummary>()
    let from = 0
    let incomplete = false
    for (let page = 0; page < MARKET_LIMITS.maxSearchPages; page += 1) {
      const url = new URL('/-/v1/search', this.registry)
      url.searchParams.set('text', text)
      url.searchParams.set('size', String(MARKET_LIMITS.searchPageSize))
      url.searchParams.set('from', String(from))
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(MARKET_LIMITS.requestTimeoutMs) })
      if (!response.ok) throw new Error(`Registry search failed: HTTP ${response.status}`)
      const body = (await response.json()) as {
        objects?: Array<{ package?: { name?: string; version?: string; description?: string; publisher?: { username?: string }; date?: string } }>
        total?: number
      }
      const objects = Array.isArray(body.objects) ? body.objects : []
      for (const object of objects) {
        const parsed = parseMarketPackageName(object.package?.name ?? '')
        if (!parsed || (kind !== 'all' && parsed.kind !== kind)) continue
        if (packages.has(parsed.name)) continue
        packages.set(parsed.name, {
          name: parsed.name,
          kind: parsed.kind,
          version: object.package?.version ?? '',
          description: object.package?.description ?? '',
          author: object.package?.publisher?.username ?? '',
          license: '',
          unpackedSize: null,
          deprecated: false,
          compatible: null
        })
      }
      from += objects.length
      const total = typeof body.total === 'number' ? body.total : from
      if (objects.length === 0 || from >= total) {
        incomplete = false
        break
      }
      incomplete = page === MARKET_LIMITS.maxSearchPages - 1
    }
    const result: MarketSearchResult = {
      packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)),
      incomplete,
      fromCache: false,
      offline: false
    }
    this.cache = { at: Date.now(), key, result }
    return result
  }

  async package(name: string): Promise<RegistryPackage> {
    const cached = this.packageCache.get(name)
    if (cached && Date.now() - cached.at < MARKET_LIMITS.cacheTtlMs) return cached.value
    const parsed = parseMarketPackageName(name)
    if (!parsed) throw new Error(`Refusing unofficial package: ${name}`)
    const url = new URL(`/${name.replace('/', '%2f')}`, this.registry)
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(MARKET_LIMITS.requestTimeoutMs) })
    if (response.status === 404) throw new Error(`Package is not published: ${name}`)
    if (!response.ok) throw new Error(`Registry metadata failed: HTTP ${response.status}`)
    const body = (await response.json()) as {
      name?: string
      description?: string
      author?: { name?: string } | string
      license?: string
      'dist-tags'?: Record<string, string>
      versions?: Record<string, RegistryVersionBody>
    }
    if (body.name !== name) throw new Error('Registry metadata name does not match the request')
    const versions = Object.values(body.versions ?? {})
      .map((version) => normalizeVersion(version))
      .filter((version): version is RegistryVersion => version !== null)
      .sort((a, b) => semver.rcompare(a.version, b.version))
    if (!versions.length) throw new Error('Registry metadata did not include a usable version')
    const author =
      typeof body.author === 'string' ? body.author : (body.author?.name ?? versions[0]?.license ?? '')
    const value = {
      name,
      description: body.description ?? '',
      author,
      license: body.license ?? versions[0]?.license ?? '',
      distTags: body['dist-tags'] ?? {},
      versions
    }
    this.packageCache.set(name, { at: Date.now(), value })
    return value
  }

  selectVersion(pack: RegistryPackage, appVersion: string, requested?: string): RegistryVersion {
    const candidates = pack.versions.filter((version) => !version.deprecated && !version.scripts.length)
    const pool = requested ? candidates.filter((version) => version.version === requested) : candidates
    const compatible = pool.find((version) => versionMatchesApp(version, appVersion))
    if (!compatible) throw new Error(`No compatible version of ${pack.name}`)
    if ((compatible.tarballSize ?? 0) > MARKET_LIMITS.maxTarballBytes) {
      throw new Error('Package tarball exceeds the size limit')
    }
    if ((compatible.unpackedSize ?? 0) > MARKET_LIMITS.maxUnpackedBytes) {
      throw new Error('Package unpack size exceeds the limit')
    }
    if (!compatible.tarball.startsWith(`${this.registry}/`)) {
      throw new Error('Package tarball is not hosted on the trusted registry')
    }
    return compatible
  }
}

interface RegistryVersionBody {
  version?: string
  deprecated?: string
  license?: string
  scripts?: Record<string, string>
  piHarness?: { compatible?: string }
  dist?: { integrity?: string; tarball?: string; unpackedSize?: number; size?: number }
}

function normalizeVersion(body: RegistryVersionBody): RegistryVersion | null {
  if (!body.version || !semver.valid(body.version) || !body.dist?.integrity || !body.dist.tarball) {
    return null
  }
  const scripts = Object.entries(body.scripts ?? {})
    .filter(([, command]) => typeof command === 'string' && command.trim())
    .map(([name]) => name)
  return {
    version: body.version,
    deprecated: typeof body.deprecated === 'string' && body.deprecated.length > 0,
    integrity: body.dist.integrity,
    tarball: body.dist.tarball,
    unpackedSize: typeof body.dist.unpackedSize === 'number' ? body.dist.unpackedSize : null,
    tarballSize: typeof body.dist.size === 'number' ? body.dist.size : null,
    license: body.license ?? '',
    compatible: body.piHarness?.compatible ?? null,
    scripts
  }
}

function versionMatchesApp(version: RegistryVersion, appVersion: string): boolean {
  if (!version.compatible) return false
  const coerced = semver.coerce(appVersion)
  if (!coerced) return false
  return semver.satisfies(coerced, version.compatible, { includePrerelease: true })
}
