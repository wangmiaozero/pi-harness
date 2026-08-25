/**
 * Application updater backed by electron-updater.
 *
 * Installed builds check in the background, download updates automatically,
 * and install them on normal app quit. Users can also install immediately by
 * choosing "Install & Restart" after the download is ready.
 */

import { app } from 'electron'
import { gt as isVersionGreater, valid as validVersion } from 'semver'
import type { AppUpdateState } from '@shared/ipc/api-types'
import { APP_VERSION } from '@shared/constants/index'
import { log } from '../services/logger'

type AutoUpdater = typeof import('electron-updater').autoUpdater
type UpdateStateListener = (state: AppUpdateState) => void

const LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/wangmiaozero/pi-harness/releases/latest'
const RELEASE_CHECK_TIMEOUT_MS = 8_000

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
      updateState({
        supported: true,
        status: 'checking',
        downloaded: false,
        downloadProgress: null
      })
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
    if (!result) return recoverFromUpdaterFailure(new Error('Updater returned no result'))

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
    log.updater.error('checkForUpdates failed:', error)
    return recoverFromUpdaterFailure(error)
  }
}

/**
 * electron-updater requires latest*.yml and platform payloads. If a Release is
 * incomplete, fall back to GitHub's stable Release API so the UI can still
 * distinguish "already current" from "new version requires manual install".
 */
async function recoverFromUpdaterFailure(updaterError: unknown): Promise<AppUpdateState> {
  try {
    const latestVersion = await fetchLatestReleaseVersion()
    const currentVersion = validVersion(APP_VERSION)
    if (!currentVersion) throw new Error(`Invalid current version: ${APP_VERSION}`)

    if (isVersionGreater(latestVersion, currentVersion)) {
      log.updater.warn('automatic update metadata unavailable; manual update required', {
        currentVersion,
        latestVersion
      })
      return updateState({
        supported: true,
        available: true,
        latestVersion,
        status: 'manual-update',
        downloaded: false,
        downloadProgress: null
      })
    }

    log.updater.info('release API confirms current version:', currentVersion)
    return updateState({
      supported: true,
      available: false,
      latestVersion,
      status: 'not-available',
      downloaded: false,
      downloadProgress: null
    })
  } catch (fallbackError) {
    log.updater.error('release API fallback failed:', fallbackError, {
      updaterError
    })
    return updateState({
      supported: true,
      status: 'error',
      downloaded: false,
      downloadProgress: null
    })
  }
}

async function fetchLatestReleaseVersion(): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RELEASE_CHECK_TIMEOUT_MS)
  timer.unref()
  try {
    const response = await fetch(LATEST_RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Pi-Harness/${APP_VERSION}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`GitHub Releases API returned HTTP ${response.status}`)
    const payload = (await response.json()) as { tag_name?: unknown }
    const rawTag = typeof payload.tag_name === 'string' ? payload.tag_name.trim() : ''
    const version = validVersion(rawTag.replace(/^v/i, ''))
    if (!version) throw new Error('GitHub Releases API returned an invalid tag')
    return version
  } finally {
    clearTimeout(timer)
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
