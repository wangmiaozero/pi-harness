// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  directory: '',
  fetch: vi.fn(),
  open: vi.fn(),
  reveal: vi.fn(),
  quit: vi.fn(),
  relaunch: vi.fn(),
  getVersion: vi.fn(() => '2.2.1')
}))
vi.mock('electron', async () => {
  const { fakeNetRequest } = await import('./net-request-fixture')
  return {
    app: {
      isPackaged: true,
      getVersion: mocks.getVersion,
      getPath: () => mocks.directory,
      quit: mocks.quit,
      relaunch: mocks.relaunch
    },
    net: { request: fakeNetRequest((url, init) => mocks.fetch(url, init)).request },
    shell: { openExternal: mocks.open, showItemInFolder: mocks.reveal }
  }
})
vi.mock('./policy', () => ({ readUpdateMode: () => 'manual' }))
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-main-'))
})
afterEach(async () => {
  ;(await import('./index')).stopAutomaticUpdates()
  await fs.rm(mocks.directory, { recursive: true, force: true })
})
it.each(['2.2.0', '2.2.1'])(
  'reports no newer version for %s without loading an installer',
  async (version) => {
    mocks.fetch.mockImplementation(
      async () => new Response(JSON.stringify({ tag_name: `v${version}` }))
    )
    const updater = await import('./index')
    expect(await updater.checkForUpdates()).toMatchObject({
      status: 'idle',
      available: false,
      currentVersion: '2.2.1',
      latestVersion: version,
      canInstall: false
    })
    expect(mocks.quit).not.toHaveBeenCalled()
  }
)
it('keeps unsigned historical versions as manual information and never silently downloads them', async () => {
  mocks.fetch.mockImplementation(async (url: string) =>
    url.includes('api.github.com')
      ? new Response(JSON.stringify({ tag_name: 'v2.2.2' }))
      : new Response(null, { status: 404 })
  )
  const updater = await import('./index')
  expect(await updater.checkForUpdates()).toMatchObject({
    status: 'manual_fallback',
    available: true,
    signature: 'missing',
    downloaded: false
  })
  expect(await updater.downloadUpdate()).toMatchObject({ canInstall: false, downloaded: false })
  await expect(updater.installUpdate()).rejects.toMatchObject({ code: 'SECURITY_ERROR' })
  expect(mocks.quit).not.toHaveBeenCalled()
})
it('follows the signed release files through the GitHub CDN redirect', async () => {
  const cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/9/'
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url.includes('api.github.com')) return new Response(JSON.stringify({ tag_name: 'v2.2.2' }))
    const file = url.split('/').pop()
    if (url.startsWith('https://github.com/'))
      return new Response(null, { status: 302, headers: { location: cdn + file } })
    return new Response(file === 'checksums.json.sig' ? '{"schemaVersion":1}' : '{}')
  })
  const updater = await import('./index')
  // Reaching signature verification proves both files crossed the redirect; a transport
  // that fails redirects reports a missing signature instead.
  expect(await updater.checkForUpdates()).toMatchObject({
    status: 'manual_fallback',
    available: true,
    signature: 'invalid',
    downloaded: false
  })
  expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
    'https://api.github.com/repos/wangmiaozero/pi-harness/releases/latest',
    'https://github.com/wangmiaozero/pi-harness/releases/download/v2.2.2/checksums.json.sig',
    cdn + 'checksums.json.sig',
    'https://github.com/wangmiaozero/pi-harness/releases/download/v2.2.2/checksums.json',
    cdn + 'checksums.json'
  ])
})
it('deduplicates simultaneous checks and safely reports complete network failure', async () => {
  mocks.fetch.mockRejectedValue(new Error('offline'))
  const updater = await import('./index')
  const first = updater.checkForUpdates(),
    second = updater.checkForUpdates()
  expect(first).toBe(second)
  expect(await first).toMatchObject({ status: 'failed', available: false, canInstall: false })
})
it('opens only the fixed official release page', async () => {
  await (await import('./index')).openReleasePage()
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
    'https://github.com/wangmiaozero/pi-harness/releases/latest'
  )
})
it('persists the opt-out and does not install when deferred or stopped', async () => {
  const updater = await import('./index')
  await updater.updatePreferences({ autoCheck: false, autoDownload: false })
  expect(updater.deferUpdate()).toMatchObject({
    canInstall: false,
    preferences: { autoCheck: false }
  })
  updater.startAutomaticUpdates(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(mocks.fetch).not.toHaveBeenCalled()
  expect(mocks.quit).not.toHaveBeenCalled()
})
it('loads persisted startup state before answering a state request', async () => {
  const updates = path.join(mocks.directory, 'updates')
  await fs.mkdir(updates)
  await fs.writeFile(
    path.join(updates, 'preferences.json'),
    JSON.stringify({ autoCheck: false, autoDownload: false })
  )
  const updater = await import('./index')
  expect(await updater.getUpdateState()).toMatchObject({
    status: 'idle',
    preferences: { autoCheck: false, autoDownload: false },
    canInstall: false
  })
  updater.startAutomaticUpdates(0)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(mocks.fetch).not.toHaveBeenCalled()
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ tag_name: 'v2.2.1' })))
  expect(await updater.checkForUpdates()).toMatchObject({ status: 'idle', latestVersion: '2.2.1' })
  expect(mocks.fetch).toHaveBeenCalledOnce()
})
