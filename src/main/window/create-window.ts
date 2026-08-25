/**
 * Main window creation + Electron security defaults.
 */

import { BrowserWindow } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_WINDOW } from '@shared/constants/index'
import { getIsDev } from '../services/app-paths'
import { log } from '../services/logger'
import { attachRendererGuards } from './renderer-guards'
import { resolvePreload } from './preload-path'

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

  attachRendererGuards(win, rendererUrl)

  if (developmentRendererUrl) {
    void win.loadURL(developmentRendererUrl)
    log.app.info('loaded development renderer')
  } else {
    void win.loadFile(rendererEntry)
  }

  return win
}
