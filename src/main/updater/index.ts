/**
 * Auto-updater — electron-updater with safe defaults.
 *
 * Strategy (0.2.0):
 *   - Packaged builds: check GitHub Releases via electron-updater.
 *   - Dev / unpackaged: return a clear "not available" result (no fake success).
 *   - Never auto-download or auto-install on launch.
 *   - User must explicitly Check / Download / Install & Restart.
 */

import { app } from 'electron'
import { log } from '../services/logger'
import { APP_VERSION } from '@shared/constants/index'

export type UpdateStatus =
  'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateCheckResult {
  available: boolean
  currentVersion: string
  latestVersion: string | null
  status: UpdateStatus
  message: string
  downloaded: boolean
}

let lastStatus: UpdateStatus = 'idle'
let downloaded = false
let latestVersion: string | null = null
let autoUpdaterLoaded: typeof import('electron-updater').autoUpdater | null = null

async function getAutoUpdater() {
  if (autoUpdaterLoaded) return autoUpdaterLoaded
  if (!app.isPackaged) return null
  try {
    const mod = await import('electron-updater')
    const au = mod.autoUpdater
    au.autoDownload = false
    au.autoInstallOnAppQuit = false
    au.on('error', (err: Error) => {
      lastStatus = 'error'
      log.updater.error('updater error:', err)
    })
    au.on('update-available', (info: { version: string }) => {
      lastStatus = 'available'
      latestVersion = info.version
      log.updater.info('update available:', info.version)
    })
    au.on('update-not-available', () => {
      lastStatus = 'not-available'
      log.updater.info('no update available')
    })
    au.on('download-progress', (p: { percent: number }) => {
      lastStatus = 'downloading'
      log.updater.debug('download progress:', Math.round(p.percent))
    })
    au.on('update-downloaded', (info: { version: string }) => {
      lastStatus = 'downloaded'
      downloaded = true
      latestVersion = info.version
      log.updater.info('update downloaded:', info.version)
    })
    autoUpdaterLoaded = au
    return au
  } catch (err) {
    log.updater.warn('electron-updater unavailable:', err)
    return null
  }
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = APP_VERSION
  const au = await getAutoUpdater()
  if (!au) {
    lastStatus = 'not-available'
    return {
      available: false,
      currentVersion,
      latestVersion: null,
      status: 'not-available',
      downloaded: false,
      message: 'Automatic updates are available only in packaged builds.'
    }
  }

  lastStatus = 'checking'
  try {
    const result = await au.checkForUpdates()
    const version = result?.updateInfo?.version ?? null
    const available = Boolean(version && version !== currentVersion)
    lastStatus = available ? 'available' : 'not-available'
    latestVersion = version
    return {
      available,
      currentVersion,
      latestVersion: version,
      status: lastStatus,
      downloaded,
      message: available
        ? `Update available: ${version}`
        : `You are on the latest version (${currentVersion}).`
    }
  } catch (err) {
    lastStatus = 'error'
    log.updater.error('checkForUpdates failed:', err)
    return {
      available: false,
      currentVersion,
      latestVersion: null,
      status: 'error',
      downloaded: false,
      message: (err as Error).message || 'Update check failed'
    }
  }
}

export async function downloadUpdate(): Promise<UpdateCheckResult> {
  const au = await getAutoUpdater()
  const currentVersion = APP_VERSION
  if (!au) {
    return {
      available: false,
      currentVersion,
      latestVersion: null,
      status: 'not-available',
      downloaded: false,
      message: 'Download is only available in packaged builds.'
    }
  }
  try {
    lastStatus = 'downloading'
    await au.downloadUpdate()
    return {
      available: true,
      currentVersion,
      latestVersion,
      status: lastStatus,
      downloaded,
      message: downloaded
        ? `Update ${latestVersion} downloaded. Restart to install.`
        : 'Download started…'
    }
  } catch (err) {
    lastStatus = 'error'
    return {
      available: true,
      currentVersion,
      latestVersion,
      status: 'error',
      downloaded: false,
      message: (err as Error).message || 'Download failed'
    }
  }
}

export async function installUpdate(): Promise<void> {
  const au = await getAutoUpdater()
  if (!au || !downloaded) {
    throw new Error('No downloaded update to install')
  }
  // Quit and install — user-initiated only.
  au.quitAndInstall(false, true)
}

export function getUpdateState(): {
  status: UpdateStatus
  downloaded: boolean
  latestVersion: string | null
  currentVersion: string
} {
  return {
    status: lastStatus,
    downloaded,
    latestVersion,
    currentVersion: APP_VERSION
  }
}
