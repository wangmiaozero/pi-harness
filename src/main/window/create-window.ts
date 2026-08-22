/**
 * Main window creation + Electron security defaults.
 */

import { BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { DEFAULT_WINDOW } from '@shared/constants/index'
import { getIsDev } from '../services/app-paths'
import { log } from '../services/logger'
import { isAllowedRendererNavigation } from './navigation-policy'

function resolvePreload(): string {
  const dir = path.join(import.meta.dirname, '../preload')
  for (const name of ['index.js', 'index.cjs', 'index.mjs']) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  return path.join(dir, 'index.mjs')
}

export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const rendererEntry = path.join(import.meta.dirname, '../renderer/index.html')
  const developmentRendererUrl =
    getIsDev() && process.env['ELECTRON_RENDERER_URL'] ? process.env['ELECTRON_RENDERER_URL'] : null
  const rendererUrl = developmentRendererUrl ?? pathToFileURL(rendererEntry).href

  const win = new BrowserWindow({
    width: DEFAULT_WINDOW.width,
    height: DEFAULT_WINDOW.height,
    minWidth: DEFAULT_WINDOW.minWidth,
    minHeight: DEFAULT_WINDOW.minHeight,
    show: false,
    backgroundColor: '#17191C',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 18 }
        }
      : {
          frame: false
        }),
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload requires sandbox:false; keep contextIsolation + no nodeIntegration.
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // Pi-Harness is a desktop-only application. Renderer content must never
  // create a browser window or hand a URL to the system browser.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererNavigation(url, rendererUrl)) {
      event.preventDefault()
      log.app.warn('blocked navigation outside the desktop application')
    }
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    log.app.error('preload failed', { preloadPath, error: String(error) })
  })

  if (developmentRendererUrl) {
    void win.loadURL(developmentRendererUrl)
    log.app.info('loaded development renderer')
  } else {
    void win.loadFile(rendererEntry)
  }

  return win
}
