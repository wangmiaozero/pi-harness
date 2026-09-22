import { app, nativeImage, type BrowserWindow } from 'electron'
import path from 'node:path'
import type { AppSettings } from '@shared/ipc/api-types'
import { isMingDynastyTheme, resolveAppIcon, type AppIconId } from '@shared/constants/app-icon'
import { log } from '../services/logger'

type IconSettings = Pick<AppSettings, 'appIcon' | 'mascotStyle' | 'mascotUnlocked'>

export function appIconPath(id: AppIconId): string {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'app-icons')
    : path.resolve(import.meta.dirname, '../../build/app-icons')
  return path.join(root, `${id}.png`)
}

export function selectedAppIconPath(settings: IconSettings): string {
  return appIconPath(
    resolveAppIcon(
      settings.appIcon,
      isMingDynastyTheme(settings.mascotStyle, settings.mascotUnlocked)
    )
  )
}

export function applyAppIcon(settings: IconSettings, window: BrowserWindow | null): void {
  try {
    const image = nativeImage.createFromPath(selectedAppIconPath(settings))
    if (image.isEmpty()) {
      log.app.warn('selected application icon could not be loaded')
      return
    }
    if (process.platform === 'darwin') {
      app.dock?.setIcon(image)
    } else if (window && !window.isDestroyed()) {
      window.setIcon(image)
    }
  } catch (error) {
    log.app.warn('failed to apply application icon', error)
  }
}
