/**
 * Click-through fullscreen overlay that paints an ai-motion ring on each
 * display edge. It is an experience-layer window only: no privileged IPC,
 * never steals focus, and must not keep the app alive after the main window
 * closes.
 */

import { BrowserWindow, screen, type Display, type Rectangle } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getIsDev } from '../services/app-paths'
import { log } from '../services/logger'
import { attachRendererGuards } from './renderer-guards'
import { resolvePreload } from './preload-path'
import type { ScreenMotionActivePayload } from '@shared/ipc/api-types'
import { IPC_EVENT } from '@shared/ipc/channels'

const OVERLAY_TITLE = 'Pi-Harness Screen Motion'

export function overlayBoundsForDisplay(display: Pick<Display, 'bounds'>): Rectangle {
  return { ...display.bounds }
}

export class ScreenMotionOverlayController {
  private windows: BrowserWindow[] = []
  private payload: ScreenMotionActivePayload = { active: false, theme: 'dark' }
  private started = false

  start(): void {
    if (this.started) return
    this.started = true
    screen.on('display-added', this.rebuild)
    screen.on('display-removed', this.rebuild)
    screen.on('display-metrics-changed', this.rebuild)
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    screen.removeListener('display-added', this.rebuild)
    screen.removeListener('display-removed', this.rebuild)
    screen.removeListener('display-metrics-changed', this.rebuild)
    this.destroyWindows()
  }

  setActive(payload: ScreenMotionActivePayload): void {
    this.payload = payload
    if (payload.active && this.windows.length === 0) {
      this.rebuild()
      return
    }
    this.syncVisibility()
    this.broadcast()
  }

  private rebuild = (): void => {
    if (!this.started) return
    this.destroyWindows()
    if (!this.payload.active) return
    for (const display of screen.getAllDisplays()) {
      const win = this.createOverlayWindow(display)
      if (win) this.windows.push(win)
    }
    this.syncVisibility()
    this.broadcast()
  }

  private createOverlayWindow(display: Display): BrowserWindow | null {
    const bounds = overlayBoundsForDisplay(display)
    const isMac = process.platform === 'darwin'
    const rendererEntry = path.join(import.meta.dirname, '../renderer/overlay.html')
    const developmentRendererUrl =
      getIsDev() && process.env['ELECTRON_RENDERER_URL']
        ? `${process.env['ELECTRON_RENDERER_URL'].replace(/\/$/, '')}/overlay.html`
        : null
    const rendererUrl = developmentRendererUrl ?? pathToFileURL(rendererEntry).href

    let win: BrowserWindow
    try {
      win = new BrowserWindow({
        ...bounds,
        title: OVERLAY_TITLE,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        skipTaskbar: true,
        focusable: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        show: false,
        enableLargerThanScreen: true,
        paintWhenInitiallyHidden: true,
        ...(isMac
          ? {
              type: 'panel' as const,
              roundedCorners: false,
              hiddenInMissionControl: true
            }
          : {}),
        webPreferences: {
          preload: resolvePreload('overlay'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
          spellcheck: false,
          backgroundThrottling: false
        }
      })
    } catch (error) {
      log.app.warn('screen motion overlay unavailable', { error: String(error) })
      return null
    }

    attachRendererGuards(win, rendererUrl)
    this.applyClickThrough(win)
    win.setAlwaysOnTop(true, 'screen-saver')
    if (isMac) {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }

    win.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) this.sendPayload(win)
    })

    if (developmentRendererUrl) {
      void win.loadURL(developmentRendererUrl)
    } else {
      void win.loadFile(rendererEntry)
    }

    return win
  }

  private applyClickThrough(win: BrowserWindow): void {
    try {
      win.setIgnoreMouseEvents(true, { forward: true })
    } catch (error) {
      log.app.warn('screen motion click-through failed', { error: String(error) })
    }
  }

  private syncVisibility(): void {
    for (const win of this.windows) {
      if (win.isDestroyed()) continue
      if (this.payload.active) {
        this.applyClickThrough(win)
        win.setAlwaysOnTop(true, 'screen-saver')
        if (!win.isVisible()) win.showInactive()
      } else if (win.isVisible()) {
        win.hide()
      }
    }
  }

  private broadcast(): void {
    for (const win of this.windows) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      this.sendPayload(win)
    }
  }

  private sendPayload(win: BrowserWindow): void {
    win.webContents.send(IPC_EVENT.aiMotionActive, this.payload)
  }

  private destroyWindows(): void {
    for (const win of this.windows) {
      if (win.isDestroyed()) continue
      win.destroy()
    }
    this.windows = []
  }
}
