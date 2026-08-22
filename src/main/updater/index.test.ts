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
})
