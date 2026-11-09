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

async function releaseProvider(platform: 'darwin' | 'win32' | 'linux') {
  const config = await getConfig(process.cwd(), 'electron-builder.yml')
  const sources = Array.isArray(config.publish) ? config.publish : [config.publish]
  expect(sources).toHaveLength(1)
  vi.stubEnv('TEST_UPDATER_ARCH', 'x64')
  const request = vi.fn(async (options: RequestOptions) => {
    const pathname = options.path ?? ''
    if (pathname.endsWith('/releases.atom')) {
      return '<feed><entry><title>Release</title><link href="https://github.com/wangmiaozero/pi-harness/releases/tag/v9.0.0"/><content>Update</content></entry></feed>'
    }
    if (pathname.endsWith('/latest')) return JSON.stringify({ tag_name: 'v9.0.0' })
    const file = 'Pi-Harness-9.0.0.zip'
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
    ['darwin', 'latest-mac.yml'],
    ['win32', 'latest.yml'],
    ['linux', 'latest-linux.yml']
  ] as const)('%s reads only %s from the stable release', async (platform, file) => {
    const { provider, request } = await releaseProvider(platform)
    const update = await provider.getLatestVersion()
    expect(update.version).toBe('9.0.0')
    const metadataRequests = request.mock.calls
      .map(([options]) => options.path)
      .filter((pathname) => pathname?.endsWith('.yml'))
    expect(metadataRequests).toEqual([`/wangmiaozero/pi-harness/releases/download/v9.0.0/${file}`])
    const payload = provider.resolveFiles(update)[0].url.pathname
    expect(payload.endsWith('/Pi-Harness-9.0.0.zip')).toBe(true)
  })
})

describe('native packaging architecture selection', () => {
  it('keeps target architectures selectable by the native job', async () => {
    const file = 'electron-builder.yml'
      const config = (await getConfig(process.cwd(), file)) as unknown as Record<
        string,
        { target: Array<string | { arch?: unknown }> }
      >
      for (const platform of ['mac', 'win', 'linux'])
        expect(
          config[platform].target.every(
            (target) => typeof target === 'string' || target.arch === undefined
          )
        ).toBe(true)
  })
})
