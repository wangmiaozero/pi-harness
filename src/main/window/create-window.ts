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
import { installArchitectureFullscreen } from './architecture-fullscreen'

export function createMainWindow(iconPath: string): BrowserWindow {
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
    icon: iconPath,
    // Keep the native macOS titlebar behavior (drag and double-click zoom),
    // while drawing the title and controls ourselves in the renderer.
    frame: process.platform === 'darwin',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const } : {}),
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload requires sandbox:false; keep contextIsolation + no nodeIntegration.
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      disableHtmlFullscreenWindowResize: process.platform === 'darwin'
    }
  })

  if (process.platform === 'darwin') win.setWindowButtonVisibility(false)
  installArchitectureFullscreen(win)
  // Native non-client dragging consumes OS pointer events. Handle double-clicks
  // delivered to Chromium too (e.g. accessibility input), using the live DOM
  // drag rectangle so controls/search and theme-specific heights stay excluded.
  if (process.platform === 'darwin')
    win.webContents.on('before-mouse-event', (_event, input) => {
      if (
        input.type !== 'mouseDown' ||
        input.button !== 'left' ||
        input.clickCount !== 2 ||
        !Number.isFinite(input.x) ||
        !Number.isFinite(input.y)
      )
        return
      void win.webContents
        .executeJavaScript(
          `Boolean(document.elementFromPoint(${input.x},${input.y})?.closest('[data-testid="titlebar-drag-area"]'))`
        )
        .then((isTitlebar) => {
          if (!isTitlebar || win.isDestroyed()) return
          if (win.isMaximized()) win.unmaximize()
          else win.maximize()
        })
        .catch(() => undefined)
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
