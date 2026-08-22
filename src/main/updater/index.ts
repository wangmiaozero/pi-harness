/**
 * Application updater backed by electron-updater.
 *
 * Installed builds check in the background, download updates automatically,
 * and install them on normal app quit. Users can also install immediately by
 * choosing "Install & Restart" after the download is ready.
 */

import { app } from 'electron'
import type { AppUpdateState } from '@shared/ipc/api-types'
import { APP_VERSION } from '@shared/constants/index'
import { log } from '../services/logger'

type AutoUpdater = typeof import('electron-updater').autoUpdater
type UpdateStateListener = (state: AppUpdateState) => void

const state: AppUpdateState = {
  supported: false,
  available: false,
  currentVersion: APP_VERSION,
  latestVersion: null,
  status: 'idle',
  downloaded: false,
  downloadProgress: null
}

const listeners = new Set<UpdateStateListener>()
let autoUpdaterLoaded: AutoUpdater | null = null
let automaticCheckTimer: ReturnType<typeof setTimeout> | null = null

function snapshot(): AppUpdateState {
  return { ...state }
}

function updateState(patch: Partial<AppUpdateState>): AppUpdateState {
  Object.assign(state, patch)
  const next = snapshot()
  for (const listener of listeners) {
    try {
      listener(next)
    } catch (error) {
      log.updater.warn('update state listener failed:', error)
    }
  }
  return next
}

async function getAutoUpdater(): Promise<AutoUpdater | null> {
  if (autoUpdaterLoaded) return autoUpdaterLoaded
  if (!app.isPackaged) return null

  try {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = log.updater

    autoUpdater.on('checking-for-update', () => {
      updateState({ supported: true, status: 'checking', downloadProgress: null })
    })
    autoUpdater.on('update-available', (info) => {
      updateState({
        supported: true,
        available: true,
        latestVersion: info.version,
        status: 'available',
        downloaded: false,
        downloadProgress: 0
      })
      log.updater.info('update available:', info.version)
    })
    autoUpdater.on('update-not-available', (info) => {
      updateState({
        supported: true,
        available: false,
        latestVersion: info.version ?? APP_VERSION,
        status: 'not-available',
        downloaded: false,
        downloadProgress: null
      })
      log.updater.info('no update available')
    })
    autoUpdater.on('download-progress', (progress) => {
      updateState({
        supported: true,
        available: true,
        status: 'downloading',
        downloadProgress: Math.max(0, Math.min(100, progress.percent))
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      updateState({
        supported: true,
        available: true,
        latestVersion: info.version,
        status: 'downloaded',
        downloaded: true,
        downloadProgress: 100
      })
      log.updater.info('update downloaded:', info.version)
    })
    autoUpdater.on('error', (error) => {
      updateState({ supported: true, status: 'error', downloadProgress: null })
      log.updater.error('updater error:', error)
    })

    autoUpdaterLoaded = autoUpdater
    updateState({ supported: true })
    return autoUpdater
  } catch (error) {
    updateState({ supported: true, status: 'error', downloadProgress: null })
    log.updater.error('electron-updater unavailable:', error)
    return null
  }
}

export function getUpdateState(): AppUpdateState {
  if (!app.isPackaged) return { ...state, supported: false, status: 'idle' }
  return snapshot()
}

export function onUpdateState(listener: UpdateStateListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function checkForUpdates(): Promise<AppUpdateState> {
  if (automaticCheckTimer) {
    clearTimeout(automaticCheckTimer)
    automaticCheckTimer = null
  }
  const autoUpdater = await getAutoUpdater()
  if (!autoUpdater) return getUpdateState()

  updateState({ supported: true, status: 'checking', downloadProgress: null })
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) return updateState({ supported: true, status: 'error', downloadProgress: null })

    const available = result.isUpdateAvailable
    const latestVersion = result.updateInfo.version ?? null
    if (!available) {
      return updateState({
        available: false,
        latestVersion,
        status: 'not-available',
        downloaded: false,
        downloadProgress: null
      })
    }

    // autoDownload starts as part of checkForUpdates(). Do not overwrite a
    // newer progress/downloaded event that may already have arrived.
    if (state.status === 'checking') {
      updateState({
        available: true,
        latestVersion,
        status: 'available',
        downloaded: false,
        downloadProgress: 0
      })
    }
    return snapshot()
  } catch (error) {
    updateState({ supported: true, status: 'error', downloadProgress: null })
    log.updater.error('checkForUpdates failed:', error)
    return snapshot()
  }
}

/** Retained as an explicit retry path; normal downloads start automatically. */
export async function downloadUpdate(): Promise<AppUpdateState> {
  const autoUpdater = await getAutoUpdater()
  if (!autoUpdater) return getUpdateState()

  try {
    updateState({ supported: true, available: true, status: 'downloading' })
    await autoUpdater.downloadUpdate()
  } catch (error) {
    updateState({ supported: true, status: 'error', downloadProgress: null })
    log.updater.error('downloadUpdate failed:', error)
  }
  return snapshot()
}

export async function installUpdate(): Promise<void> {
  const autoUpdater = await getAutoUpdater()
  if (!autoUpdater || !state.downloaded) throw new Error('No downloaded update to install')
  autoUpdater.quitAndInstall(false, true)
}

export function startAutomaticUpdates(delayMs = 10_000): void {
  if (!app.isPackaged || automaticCheckTimer) return
  automaticCheckTimer = setTimeout(
    () => {
      automaticCheckTimer = null
      void checkForUpdates()
    },
    Math.max(0, delayMs)
  )
  automaticCheckTimer.unref()
}

export function stopAutomaticUpdates(): void {
  if (!automaticCheckTimer) return
  clearTimeout(automaticCheckTimer)
  automaticCheckTimer = null
}
