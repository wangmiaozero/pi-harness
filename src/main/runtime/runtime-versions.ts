import { installedSdkVersions } from './sdk-matrix.mjs'
import semver from 'semver'
import { z } from 'zod'
import manifest from '../../../package.json'
import { catalog, type RuntimeFetcher } from './distribution.mjs'
import { PI_SDK_PACKAGES, npmStable, githubStable, nodeLts } from './version-sources.mjs'
import { atomicWriteJson, readJsonFile } from '../services/storage'
import type {
  RuntimeDiagnostics,
  RuntimeVersionReport,
  RuntimeVersionStatus
} from '@shared/runtime/schema'

const entrySchema = z
  .object({
    version: z
      .string()
      .refine((value) => Boolean(semver.valid(value)) && !semver.prerelease(value)),
    checkedAt: z.iso.datetime()
  })
  .strict()
const cacheSchema = z
  .object({ schemaVersion: z.literal(1), entries: z.record(z.string(), entrySchema) })
  .strict()
type Cache = z.infer<typeof cacheSchema>

export class RuntimeVersionService {
  private cache: Cache | null = null
  private loading: Promise<void> | null = null
  private failed = new Set<string>()
  private pending: Promise<void> | null = null
  private sdk: Promise<Record<string, string | null>> | null = null
  constructor(
    private readonly options: {
      cacheFile: string
      fetcher?: RuntimeFetcher
      appVersion?: string
      sdkVersions?: () => Promise<Record<string, string | null>>
    }
  ) {}

  private async load(): Promise<void> {
    if (this.cache) return
    this.loading ??= (async () => {
      const value = await readJsonFile<unknown>(this.options.cacheFile).catch(() => null)
      const parsed = cacheSchema.safeParse(value)
      this.cache = parsed.success ? parsed.data : { schemaVersion: 1, entries: {} }
    })()
    await this.loading
  }
  private async refresh(): Promise<void> {
    await this.load()
    const fetcher = this.options.fetcher
    const queries: Array<[string, () => Promise<string>]> = [
      ['app', () => githubStable('wangmiaozero/pi-harness', fetcher)],
      ['pi', () => githubStable('earendil-works/pi', fetcher)],
      ['node', () => nodeLts(fetcher)],
      ...PI_SDK_PACKAGES.map((name): [string, () => Promise<string>] => [
        name,
        async () => (await npmStable(name, fetcher)).version
      ])
    ]
    const results = await Promise.allSettled(queries.map(([, query]) => query()))
    const checkedAt = new Date().toISOString()
    results.forEach((result, index) => {
      const key = queries[index][0]
      if (result.status === 'fulfilled') {
        this.cache!.entries[key] = { version: result.value, checkedAt }
        this.failed.delete(key)
      } else this.failed.add(key)
    })
    await atomicWriteJson(this.options.cacheFile, this.cache).catch(() => undefined)
  }
  async report(
    info: Pick<RuntimeDiagnostics, 'pi' | 'node'>,
    refresh = false
  ): Promise<RuntimeVersionReport> {
    await this.load()
    if (refresh) {
      this.pending ??= this.refresh().finally(() => {
        this.pending = null
      })
      await this.pending
    }
    this.sdk ??= (this.options.sdkVersions ?? installedSdkVersions)()
    const sdk = await this.sdk
    const status = (
      component: string,
      installed: string | null,
      bundled: string | null,
      source: string,
      compatible: boolean | null
    ): RuntimeVersionStatus => {
      const cached = this.cache!.entries[component]
      return {
        component,
        installedVersion: installed,
        bundledVersion: bundled,
        latestStableVersion: cached?.version ?? null,
        updateAvailable: Boolean(
          installed && cached && semver.valid(installed) && semver.gt(cached.version, installed)
        ),
        compatible,
        source,
        checkedAt: cached?.checkedAt ?? null,
        checkState: this.failed.has(component)
          ? cached
            ? 'cached'
            : 'unavailable'
          : cached
            ? refresh
              ? 'current'
              : 'cached'
            : 'not-checked'
      }
    }
    const sdkPackages = PI_SDK_PACKAGES.map((name) =>
      status(
        name,
        sdk[name],
        catalog.pi.version,
        'sdk',
        sdk[name] ? sdk[name] === catalog.pi.version : null
      )
    )
    const sdkVersion = sdkPackages.every(
      (row) => row.installedVersion === sdkPackages[0].installedVersion
    )
      ? sdkPackages[0].installedVersion
      : null
    const sdkStatus: RuntimeVersionStatus = {
      component: 'pi-sdk',
      installedVersion: sdkVersion,
      bundledVersion: catalog.pi.version,
      latestStableVersion: null,
      updateAvailable: sdkPackages.some((row) => row.updateAvailable),
      compatible:
        sdkPackages.every((row) => row.compatible === true) &&
        info.pi.valid &&
        info.pi.version === sdkVersion,
      source: 'sdk',
      checkedAt: null,
      checkState: sdkPackages.some((row) => row.checkState === 'unavailable')
        ? 'unavailable'
        : 'not-checked'
    }
    if (
      sdkPackages.every(
        (row) =>
          row.latestStableVersion && row.latestStableVersion === sdkPackages[0].latestStableVersion
      )
    ) {
      sdkStatus.latestStableVersion = sdkPackages[0].latestStableVersion
      sdkStatus.checkedAt = sdkPackages[0].checkedAt
      sdkStatus.checkState = sdkPackages.some((row) => row.checkState !== 'current')
        ? 'cached'
        : 'current'
    }
    const components = [
      status('app', this.options.appVersion ?? manifest.version, manifest.version, 'app', true),
      status(
        'pi',
        info.pi.version,
        catalog.pi.version,
        info.pi.source,
        info.pi.valid && info.pi.version === sdkVersion
      ),
      sdkStatus,
      status(
        'node',
        info.node.version,
        catalog.node.version,
        info.node.source,
        info.node.valid
          ? Boolean(info.node.version && semver.gte(info.node.version, '22.19.0'))
          : null
      )
    ]
    return {
      components,
      sdkPackages,
      checkedAt:
        components
          .map((row) => row.checkedAt)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null
    }
  }
}
