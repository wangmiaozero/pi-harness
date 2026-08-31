// @vitest-environment node
import { createRequire } from 'node:module'
import type { RequestOptions } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider'

type ProviderOptions = ConstructorParameters<typeof GitHubProvider>
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { getConfig } = builderRequire('app-builder-lib/out/util/config/config') as {
  getConfig: (directory: string, file: string) => Promise<{ publish: ProviderOptions[0] }>
}

afterEach(() => vi.unstubAllEnvs())

async function releaseProvider(
  variant: 'standard' | 'nomascot',
  platform: 'darwin' | 'win32' | 'linux',
  missingChannel = false
) {
  // Use the actual inherited builder configuration: merging publish arrays can
  // silently keep the standard feed first in a nomascot app-update.yml.
  const config = await getConfig(
    process.cwd(),
    variant === 'nomascot' ? 'electron-builder.nomascot.yml' : 'electron-builder.yml'
  )
  const sources = Array.isArray(config.publish) ? config.publish : [config.publish]
  expect(sources).toHaveLength(1)
  vi.stubEnv('TEST_UPDATER_ARCH', 'x64')
  const request = vi.fn(async (options: RequestOptions) => {
    const pathname = options.path ?? ''
    if (pathname.endsWith('/releases.atom')) {
      return '<feed><entry><title>Release</title><link href="https://github.com/wangmiaozero/pi-harness/releases/tag/v9.0.0"/><content>Update</content></entry></feed>'
    }
    if (pathname.endsWith('/latest')) return JSON.stringify({ tag_name: 'v9.0.0' })
    if (missingChannel && pathname.includes('/nomascot')) {
      throw new Error('Channel metadata unavailable')
    }
    const file = `Pi-Harness-9.0.0${pathname.includes('/nomascot') ? '-nomascot' : ''}.zip`
    return JSON.stringify({
      version: '9.0.0',
      files: [{ url: file, sha512: Buffer.alloc(64).toString('base64'), size: 1 }]
    })
  })
  const provider = new GitHubProvider(
    sources[0],
    { channel: null, allowPrerelease: false, fullChangelog: false } as ProviderOptions[1],
    {
      platform,
      isUseMultipleRangeRequest: false,
      executor: { request } as unknown as ProviderOptions[2]['executor']
    }
  )
  return { provider, request }
}

describe('packaged update channels', () => {
  it.each([
    ['standard', 'darwin', 'latest-mac.yml'],
    ['standard', 'win32', 'latest.yml'],
    ['standard', 'linux', 'latest-linux.yml'],
    ['nomascot', 'darwin', 'nomascot-mac.yml'],
    ['nomascot', 'win32', 'nomascot.yml'],
    ['nomascot', 'linux', 'nomascot-linux.yml']
  ] as const)('%s on %s reads only %s from the stable release', async (variant, platform, file) => {
    const { provider, request } = await releaseProvider(variant, platform)
    const update = await provider.getLatestVersion()
    expect(update.version).toBe('9.0.0')
    const metadataRequests = request.mock.calls
      .map(([options]) => options.path)
      .filter((pathname) => pathname?.endsWith('.yml'))
    expect(metadataRequests).toEqual([`/wangmiaozero/pi-harness/releases/download/v9.0.0/${file}`])
    const payload = provider.resolveFiles(update)[0].url.pathname
    expect(payload.includes('-nomascot.zip')).toBe(variant === 'nomascot')
  })

  it('does not download the standard variant when nomascot metadata is absent', async () => {
    const { provider, request } = await releaseProvider('nomascot', 'darwin', true)
    await expect(provider.getLatestVersion()).rejects.toThrow('Channel metadata unavailable')
    expect(request.mock.calls.some(([options]) => options.path?.endsWith('/latest-mac.yml'))).toBe(
      false
    )
  })
})
