import type { BrowserWindow } from 'electron'
import { log } from '../services/logger'
import { isAllowedRendererNavigation } from './navigation-policy'

export function attachRendererGuards(win: BrowserWindow, rendererUrl: string): void {
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

  win.webContents.on('render-process-gone', (_event, details) => {
    log.app.error('render-process-gone', details)
    if (win.isDestroyed() || details.reason === 'clean-exit') return
    if (details.reason === 'killed') return
    setTimeout(() => {
      if (win.isDestroyed()) return
      void win.loadURL(rendererUrl).catch((error) => {
        log.app.error('failed to recover renderer', error)
      })
    }, 250)
  })
}
