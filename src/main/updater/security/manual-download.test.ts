// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { signingFixture } from './signing-fixture'
import { downloadVerifiedInstaller } from './manual-download'
import { fetchOfficial, readBounded } from './transport.mjs'
import * as downloadOrigin from './download-origin'

const temporary: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of temporary.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})
async function setup(platform = 'darwin', arch = 'arm64', variant = 'standard') {
  const f = signingFixture()
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'verified-download-'))
  temporary.push(destination)
  const files = new Map<string, Buffer | null>([
    ['checksums.json.sig', f.signature],
    ['checksums.json', f.bytes],
    ...f.manifest.artifacts.map((item) => [item.file, f.payload] as [string, Buffer])
  ])
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    options?.signal?.throwIfAborted()
    const bytes = files.get(new URL(url).pathname.split('/').pop()!)
    return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 })
  })
  const options = {
    version: '2.0.1',
    currentVersion: '2.0.0',
    platform,
    arch,
    variant,
    destination,
    fetcher,
    trust: f.trust
  }
  return { f, options, files, fetcher, destination }
}
it.each([
  ['darwin', 'arm64', 'standard'],
  ['darwin', 'x64', 'nomascot'],
  ['win32', 'x64', 'standard'],
  ['linux', 'x64', 'nomascot']
])('downloads and reveals only verified %s %s %s bytes', async (platform, arch, variant) => {
  const { f, options } = await setup(platform, arch, variant)
  const file = await downloadVerifiedInstaller(options)
  expect(path.basename(file)).not.toContain('.part')
  expect(await fs.readFile(file)).toEqual(f.payload)
  expect(await fs.readdir(path.dirname(file))).toEqual([path.basename(file)])
})
it('creates a missing system Downloads directory without overwriting existing downloads', async () => {
  const { options, destination } = await setup()
  options.destination = path.join(destination, 'new-downloads')
  const file = await downloadVerifiedInstaller(options)
  expect(await fs.stat(file)).toBeTruthy()
  const second = await downloadVerifiedInstaller(options)
  expect(second).not.toBe(file)
  expect(await fs.stat(file)).toBeTruthy()
})
it('removes the partial installer if OS Internet-origin marking fails', async () => {
  const { options, destination } = await setup()
  vi.spyOn(downloadOrigin, 'markDownloadOrigin').mockRejectedValue(
    new Error('Origin marking denied')
  )
  await expect(downloadVerifiedInstaller(options)).rejects.toThrow('verified')
  expect(await fs.readdir(destination)).toEqual([])
})
it('aborts a stalled network request on a real timeout', async () => {
  const { options, destination } = await setup()
  await expect(
    downloadVerifiedInstaller({
      ...options,
      signal: AbortSignal.timeout(5),
      fetcher: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('Timed out')), {
            once: true
          })
        })
    })
  ).rejects.toThrow('verified')
  expect(await fs.readdir(destination)).toEqual([])
})
it.each([
  'missing-signature',
  'missing-manifest',
  'missing-installer',
  'wrong-key',
  'tamper-manifest',
  'tamper-installer',
  'truncated',
  'oversized',
  'wrong-version',
  'wrong-arch',
  'wrong-platform',
  'wrong-variant',
  'rollback'
])('fails closed for %s and leaves no installer', async (mode) => {
  const { f, options, files, destination, fetcher } = await setup()
  const item = f.manifest.artifacts.find((item) => item.file.endsWith('arm64.dmg'))!
  if (mode === 'missing-signature') files.delete('checksums.json.sig')
  if (mode === 'missing-manifest') files.delete('checksums.json')
  if (mode === 'missing-installer') files.delete(item.file)
  if (mode === 'wrong-key') options.trust = signingFixture().trust
  if (mode === 'tamper-manifest')
    files.set('checksums.json', Buffer.concat([f.bytes, Buffer.from(' ')]))
  if (mode === 'tamper-installer') files.set(item.file, Buffer.alloc(f.payload.length, 1))
  if (mode === 'truncated') files.set(item.file, Buffer.from('short'))
  if (mode === 'oversized') files.set(item.file, Buffer.alloc(f.payload.length + 1))
  if (mode === 'wrong-version') options.version = '3.0.0'
  if (mode === 'wrong-arch') options.arch = 'mips'
  if (mode === 'wrong-platform') options.platform = 'freebsd'
  if (mode === 'wrong-variant') options.variant = '../standard'
  if (mode === 'rollback') options.currentVersion = '2.0.1'
  await expect(downloadVerifiedInstaller(options)).rejects.toMatchObject({ code: 'SECURITY_ERROR' })
  expect(await fs.readdir(destination)).toEqual([])
  if (
    [
      'missing-signature',
      'wrong-key',
      'tamper-manifest',
      'wrong-version',
      'wrong-arch',
      'wrong-platform',
      'wrong-variant',
      'rollback'
    ].includes(mode)
  )
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('.dmg'))).toBe(false)
})
it('cleans up an interrupted stream and handles an expired timeout signal', async () => {
  const { options, fetcher, destination } = await setup()
  // Use the original fixture for metadata; interrupt only the payload response.
  fetcher.mockReset()
  const f = signingFixture()
  options.trust = f.trust
  fetcher.mockImplementation(async (url) => {
    if (url.endsWith('.sig')) return new Response(new Uint8Array(f.signature))
    if (url.endsWith('.json')) return new Response(new Uint8Array(f.bytes))
    let reads = 0
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (reads++ === 0) controller.enqueue(new Uint8Array([1, 2, 3]))
          else controller.error(new Error('network interrupted'))
        }
      })
    )
  })
  await expect(downloadVerifiedInstaller(options)).rejects.toThrow('verified')
  expect(await fs.readdir(destination)).toEqual([])
  await expect(
    downloadVerifiedInstaller({ ...options, signal: AbortSignal.abort() })
  ).rejects.toThrow('verified')
})
it.each([
  'http://github.com/wangmiaozero/pi-harness/releases/download/v2.0.1/a',
  'https://evil.example/package',
  'https://github.com/attacker/pi-harness/releases/download/v2.0.1/a',
  'https://github.com@evil.example/a',
  'https://release-assets.githubusercontent.com.evil.example/a',
  'https://127.0.0.1/a'
])('rejects unsafe redirects before fetching %s', async (target) => {
  const fetcher = vi.fn(
    async () => new Response(null, { status: 302, headers: { location: target } })
  )
  await expect(
    fetchOfficial(
      'https://github.com/wangmiaozero/pi-harness/releases/download/v2.0.1/checksums.json',
      fetcher
    )
  ).rejects.toThrow('Untrusted')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('allows the official asset CDN without forwarding the API token; bounds metadata bytes', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location:
            'https://release-assets.githubusercontent.com/github-production-release-asset/1/2?signature=value'
        }
      })
    )
    .mockResolvedValueOnce(new Response('payload'))
  const response = await fetchOfficial(
    'https://api.github.com/repos/wangmiaozero/pi-harness/releases/assets/1',
    fetcher,
    { headers: { Authorization: 'Bearer ephemeral' } }
  )
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer ephemeral')
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBeUndefined()
  expect((await readBounded(response, 7)).toString()).toBe('payload')
  await expect(readBounded(new Response('oversized'), 2)).rejects.toThrow('limit')
})
