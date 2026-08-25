import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: false },
  autoUpdater: null as unknown
}))

vi.mock('electron', () => ({ app: mocks.app }))
vi.mock('electron-updater', () => ({
  get autoUpdater() {
    return mocks.autoUpdater
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
  })

  it('stays idle and silent in an unpackaged development build', async () => {
    const updater = await import('./index')
    const result = await updater.checkForUpdates()

    expect(result).toMatchObject({ supported: false, status: 'idle', available: false })
    expect(result).not.toHaveProperty('message')
    expect((mocks.autoUpdater as FakeAutoUpdater).checkForUpdates).not.toHaveBeenCalled()
  })

  it('automatically downloads packaged updates and exposes progress', async () => {
    mocks.app.isPackaged = true
    const fake = mocks.autoUpdater as FakeAutoUpdater
    fake.checkForUpdates.mockImplementation(async () => {
      fake.emit('checking-for-update')
      fake.emit('update-available', { version: '1.1.0' })
      fake.emit('download-progress', { percent: 42.4 })
      return {
        isUpdateAvailable: true,
        updateInfo: { version: '1.1.0' }
      }
    })

    const updater = await import('./index')
    const result = await updater.checkForUpdates()

    expect(fake.autoDownload).toBe(true)
    expect(fake.autoInstallOnAppQuit).toBe(true)
    expect(result).toMatchObject({
      supported: true,
      available: true,
      latestVersion: '1.1.0',
      status: 'downloading',
      downloadProgress: 42.4
    })

    fake.emit('update-downloaded', { version: '1.1.0' })
    expect(updater.getUpdateState()).toMatchObject({
      status: 'downloaded',
      downloaded: true,
      downloadProgress: 100
    })

    await updater.installUpdate()
    expect(fake.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('uses the stable Release API when updater metadata is missing', async () => {
    mocks.app.isPackaged = true
    const fake = mocks.autoUpdater as FakeAutoUpdater
    fake.checkForUpdates.mockRejectedValue(new Error('latest-mac.yml returned HTTP 404'))
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ tag_name: 'v1.1.0' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const updater = await import('./index')
    const result = await updater.checkForUpdates()

    expect(result).toMatchObject({
      supported: true,
      available: false,
      latestVersion: '1.1.0',
      status: 'not-available'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/wangmiaozero/pi-harness/releases/latest',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('reports a manual update when a newer Release lacks updater metadata', async () => {
    mocks.app.isPackaged = true
    const fake = mocks.autoUpdater as FakeAutoUpdater
    fake.checkForUpdates.mockRejectedValue(new Error('latest-mac.yml returned HTTP 404'))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ tag_name: 'v1.2.0' })
      })
    )

    const updater = await import('./index')
    const result = await updater.checkForUpdates()

    expect(result).toMatchObject({
      supported: true,
      available: true,
      latestVersion: '1.2.0',
      status: 'manual-update',
      downloaded: false
    })
  })

  it('keeps an actionable error state when both update checks fail', async () => {
    mocks.app.isPackaged = true
    const fake = mocks.autoUpdater as FakeAutoUpdater
    fake.checkForUpdates.mockRejectedValue(new Error('network unavailable'))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')))

    const updater = await import('./index')
    const result = await updater.checkForUpdates()

    expect(result).toMatchObject({
      supported: true,
      status: 'error',
      downloaded: false,
      downloadProgress: null
    })
  })
})
