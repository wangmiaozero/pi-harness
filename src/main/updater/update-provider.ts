import { gt, valid } from 'semver'
import type { ReleaseFetcher } from './security/transport.mjs'
import { fetchOfficial, readBounded } from './security/transport.mjs'
import { verifiedManifest, selectInstaller, stableVersion } from './security/manifest.mjs'
import type { Manifest, Installer, TrustStore } from './security/manifest.mjs'
import embeddedTrust from '@release-trust'
import { UpdateError } from './update-error'

export const RELEASE_PAGE = 'https://github.com/wangmiaozero/pi-harness/releases/latest'
const API = 'https://api.github.com/repos/wangmiaozero/pi-harness/releases/latest'
const metadataSignal = (signal?: AbortSignal) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
export interface TrustedCandidate {
  version: string
  manifest: Manifest
  installer: Installer
  bytes: Buffer
  signature: Buffer
}
export class ReleaseProvider {
  constructor(
    private readonly options: {
      fetcher: ReleaseFetcher
      platform: string
      arch: string
      variant: string
      trust?: TrustStore
    }
  ) {}
  async latest(signal?: AbortSignal): Promise<string> {
    try {
      const response = await fetchOfficial(API, this.options.fetcher, {
        signal: metadataSignal(signal),
        headers: { Accept: 'application/json' }
      })
      const data = JSON.parse((await readBounded(response, 1024 * 1024)).toString('utf8'))
      const version = typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/, '') : ''
      if (data.draft || data.prerelease || !stableVersion.test(version) || !valid(version))
        throw new Error()
      return version
    } catch (error) {
      if (signal?.aborted) throw error
      // A version-only website fallback never establishes package trust.
      let url = RELEASE_PAGE
      for (let redirects = 0; redirects < 4; redirects++) {
        const response = await this.options.fetcher(url, {
          redirect: 'manual',
          signal: metadataSignal(signal)
        })
        const next = response.headers.get('location')
        if ([301, 302, 303, 307, 308].includes(response.status) && next) {
          await response.body?.cancel()
          const target = new URL(next, url)
          if (
            target.origin !== 'https://github.com' ||
            target.username ||
            target.password ||
            target.hash ||
            !/^\/wangmiaozero\/pi-harness\/releases\/(?:latest|tag\/v[0-9.]+)$/.test(
              target.pathname
            )
          )
            break
          url = target.href
          continue
        }
        await response.body?.cancel()
        const target = new URL(url)
        const match = target.pathname.match(
          /^\/wangmiaozero\/pi-harness\/releases\/tag\/v([0-9.]+)$/
        )
        if (
          response.ok &&
          !response.redirected &&
          match &&
          stableVersion.test(match[1]) &&
          valid(match[1])
        )
          return match[1]
        break
      }
      throw new UpdateError(
        'NETWORK_CHECK_FAILED',
        'The official release could not be checked.',
        true
      )
    }
  }
  async authenticate(
    version: string,
    currentVersion: string,
    signal?: AbortSignal
  ): Promise<TrustedCandidate> {
    if (
      !stableVersion.test(version) ||
      !valid(version) ||
      !valid(currentVersion) ||
      !gt(version, currentVersion)
    )
      throw new UpdateError(
        'VERSION_REJECTED',
        'The update version must be newer than the installed version.'
      )
    const base = `https://github.com/wangmiaozero/pi-harness/releases/download/v${version}/`
    const get = (name: string) =>
      fetchOfficial(base + name, this.options.fetcher, {
        signal: metadataSignal(signal)
      })
    let signature: Buffer
    try {
      signature = await readBounded(await get('checksums.json.sig'), 4096)
    } catch {
      throw new UpdateError(
        'SIGNATURE_MISSING',
        'The release signature is unavailable. This release cannot be trusted for an in-app update.',
        true
      )
    }
    let bytes: Buffer
    try {
      bytes = await readBounded(await get('checksums.json'), 1024 * 1024)
    } catch {
      throw new UpdateError('MANIFEST_MISSING', 'The signed release manifest is unavailable.', true)
    }
    let manifest: Manifest
    try {
      manifest = verifiedManifest(bytes, signature, this.options.trust ?? embeddedTrust, version)
    } catch {
      throw new UpdateError(
        'SIGNATURE_INVALID',
        'The release signature or signed manifest is invalid.'
      )
    }
    try {
      return {
        version,
        manifest,
        bytes,
        signature,
        installer: selectInstaller(
          manifest,
          this.options.platform,
          this.options.arch,
          this.options.variant
        )
      }
    } catch {
      throw new UpdateError(
        'PLATFORM_UNAVAILABLE',
        'No signed installer is available for this platform, architecture and edition.'
      )
    }
  }
}
