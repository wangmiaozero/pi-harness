import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Keep version comparisons independent of package.json release bumps.
const versions = vi.hoisted(() => ({
  current: '1.2.0',
  older: '1.1.0',
  newer: '1.2.1'
}))

const mocks = vi.hoisted(() => ({
  app: { isPackaged: false },
  autoUpdater: null as unknown,
  fetch: vi.fn(),
  openExternal: vi.fn()
}))

vi.mock('@shared/constants/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/constants/index')>()),
  APP_VERSION: versions.current
}))
vi.mock('electron', () => ({
  app: mocks.app,
  net: { fetch: mocks.fetch },
  shell: { openExternal: mocks.openExternal }
}))
vi.mock('electron-updater', () => ({
  // Match Node's real ESM namespace: autoUpdater exists only on default.
  default: {
    get autoUpdater() {
      return mocks.autoUpdater
    }
  }
}))

class FakeAutoUpdater extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = false
  logger: unknown = null
  checkForUpdates = vi.fn()
  downloadUpdate = vi.fn()
  quitAndInstall = vi.fn()
}

describe('application updater', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    mocks.app.isPackaged = false
    mocks.autoUpdater = new FakeAutoUpdater()
    mocks.fetch.mockReset()
    mocks.openExternal.mockReset()
  })

  it('compares against the public release API in an unpackaged development build', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ tag_name: `v${versions.current}` })
    })
    const updater = await import('./index')
    const result = await updater.checkForUpdates()

    expect(result).toMatchObject({
      supported: true,
      status: 'not-available',
      available: false,
      currentVersion: versions.current,
      latestVersion: versions.current
    })
    expect(result).not.toHaveProperty('message')
    // Development builds never touch electron-updater itself.
    expect((mocks.autoUpdater as FakeAutoUpdater).checkForUpdates).not.toHaveBeenCalled()
  })

  it('reports a manual update in development when the public release is newer', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ tag_name: `v${versions.newer}` })
    })
    const updater = await import('./index')

    expect(await updater.checkForUpdates()).toMatchObject({
      supported: true,
      status: 'manual-update',
      available: true,
      latestVersion: versions.newer
    })
  })

  it('automatically downloads packaged updates and exposes progress', async () => {
    mocks.app.isPackaged = true
    const fake = mocks.autoUpdater as FakeAutoUpdater
    fake.checkForUpdates.mockImplementation(async () => {
      fake.emit('checking-for-update')
      fake.emit('update-available', { version: versions.newer })
      fake.emit('download-progress', { percent: 42.4 })
      return {
        isUpdateAvailable: true,
        updateInfo: { version: versions.newer }
      }
    })

    const updater = await import('./index')
    const result = await updater.checkForUpdates()

    expect(fake.autoDownload).toBe(true)
    expect(fake.autoInstallOnAppQuit).toBe(true)
    expect(result).toMatchObject({
      supported: true,
      available: true,
      currentVersion: versions.current,
      latestVersion: versions.newer,
      status: 'downloading',
      downloadProgress: 42.4
    })

    fake.emit('update-downloaded', { version: versions.newer })
    expect(updater.getUpdateState()).toMatchObject({
      status: 'downloaded',
      downloaded: true,
      downloadProgress: 100
    })

    await updater.installUpdate()
    expect(fake.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it.each([versions.older, versions.current])(
    'reports no update for Release %s when updater metadata is missing',
    async (latestVersion) => {
      mocks.app.isPackaged = true
      const fake = mocks.autoUpdater as FakeAutoUpdater
      fake.checkForUpdates.mockRejectedValue(new Error('latest-mac.yml returned HTTP 404'))
      mocks.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ tag_name: `v${latestVersion}` })
      })

      const updater = await import('./index')
      const result = await updater.checkForUpdates()

      expect(result).toMatchObject({
        supported: true,
        available: false,
        currentVersion: versions.current,
        latestVersion,
        status: 'not-available',
        downloaded: false
      })
      expect(mocks.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/wangmiaozero/pi-harness/releases/latest',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    }
  )

  it('reports a manual update when a newer Release lacks updater metadata', async () => {
    mocks.app.isPackaged = true
    const fake = mocks.autoUpdater as FakeAutoUpdater
    fake.checkForUpdates.mockRejectedValue(new Error('latest-mac.yml returned HTTP 404'))
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ tag_name: `v${versions.newer}` })
    })

    const updater = await import('./index')
    const result = await updater.checkForUpdates()

    expect(result).toMatchObject({
      supported: true,
      available: true,
      currentVersion: versions.current,
      latestVersion: versions.newer,
      status: 'manual-update',
      downloaded: false
    })
  })

  it('keeps an actionable error state when both update checks fail', async () => {
    mocks.app.isPackaged = true
    const fake = mocks.autoUpdater as FakeAutoUpdater
    fake.checkForUpdates.mockRejectedValue(new Error('network unavailable'))
    mocks.fetch.mockRejectedValue(new Error('network unavailable'))

    const updater = await import('./index')
    const result = await updater.checkForUpdates()

    expect(result).toMatchObject({
      supported: true,
      status: 'error',
      downloaded: false,
      downloadProgress: null
    })
  })

  it('still checks the release when the updater cannot initialize', async () => {
    mocks.app.isPackaged = true
    mocks.autoUpdater = undefined
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: `v${versions.current}` })
    })

    const updater = await import('./index')
    expect(await updater.checkForUpdates()).toMatchObject({ status: 'not-available' })
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })

  it('uses the public release endpoint when the API is rate limited', async () => {
    mocks.app.isPackaged = true
    ;(mocks.autoUpdater as FakeAutoUpdater).checkForUpdates.mockRejectedValue(new Error('404'))
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 403 }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tag_name: `v${versions.newer}` })
    })

    const updater = await import('./index')
    expect(await updater.checkForUpdates()).toMatchObject({
      status: 'manual-update',
      latestVersion: versions.newer
    })
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      'https://github.com/wangmiaozero/pi-harness/releases/latest',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it.each([
    null,
    {},
    { tag_name: 'not-a-version' },
    { tag_name: 123 },
    { tag_name: `v${versions.newer}`, draft: true },
    { tag_name: `v${versions.newer}`, prerelease: true }
  ])('rejects an invalid or unpublished release response: %j', async (payload) => {
    mocks.app.isPackaged = true
    ;(mocks.autoUpdater as FakeAutoUpdater).checkForUpdates.mockRejectedValue(new Error('404'))
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => payload })

    const updater = await import('./index')
    expect(await updater.checkForUpdates()).toMatchObject({ status: 'error', available: false })
  })

  it('shares concurrent checks and registers the updater listeners once', async () => {
    mocks.app.isPackaged = true
    const fake = mocks.autoUpdater as FakeAutoUpdater
    fake.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: versions.current }
    })

    const updater = await import('./index')
    const results = await Promise.all([updater.checkForUpdates(), updater.checkForUpdates()])
    expect(results[0]).toEqual(results[1])
    expect(fake.checkForUpdates).toHaveBeenCalledOnce()
    expect(fake.listenerCount('update-available')).toBe(1)
  })

  it('preserves a download and the ready-to-install state on repeated checks', async () => {
    mocks.app.isPackaged = true
    const fake = mocks.autoUpdater as FakeAutoUpdater
    fake.checkForUpdates.mockImplementation(async () => {
      fake.emit('update-available', { version: versions.newer })
      fake.emit('download-progress', { percent: 35 })
      return { isUpdateAvailable: true, updateInfo: { version: versions.newer } }
    })

    const updater = await import('./index')
    await updater.checkForUpdates()
    expect(await updater.checkForUpdates()).toMatchObject({
      status: 'downloading',
      downloadProgress: 35
    })
    fake.emit('update-downloaded', { version: versions.newer })
    expect(await updater.checkForUpdates()).toMatchObject({
      status: 'downloaded',
      downloaded: true
    })
    expect(fake.checkForUpdates).toHaveBeenCalledOnce()
    await updater.installUpdate()
    expect(fake.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('handles a missing automatic download payload after the check resolves', async () => {
    mocks.app.isPackaged = true
    const fake = mocks.autoUpdater as FakeAutoUpdater
    let rejectDownload!: (error: Error) => void
    const downloadPromise = new Promise<never>((_resolve, reject) => {
      rejectDownload = reject
    })
    fake.checkForUpdates.mockImplementation(async () => {
      fake.emit('update-available', { version: versions.newer })
      return {
        isUpdateAvailable: true,
        updateInfo: { version: versions.newer },
        downloadPromise
      }
    })
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: `v${versions.newer}` })
    })

    const updater = await import('./index')
    await updater.checkForUpdates()
    const error = new Error('ZIP payload returned HTTP 404')
    fake.emit('error', error)
    rejectDownload(error)
    await vi.waitFor(() => {
      expect(updater.getUpdateState()).toMatchObject({
        status: 'manual-update',
        latestVersion: versions.newer,
        downloaded: false
      })
    })
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
  })

  it('opens only the application-owned release page', async () => {
    const updater = await import('./index')
    await updater.openReleasePage()
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/wangmiaozero/pi-harness/releases/latest'
    )
  })
})
