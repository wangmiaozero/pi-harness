/**
 * Desktop pet window controller (BigFish companion).
 *
 * Owns the single transparent frameless pet window: lifecycle, position
 * persistence, multi-display clamping, click-through coordination, and
 * push-delivery of pet events. Mirrors the ScreenMotionOverlayController
 * discipline — the pet window is visualization-only and holds no privileged
 * IPC surface.
 */

import { BrowserWindow, screen, app } from 'electron'
import path from 'node:path'
import type { DesktopPetSettings } from '@shared/pet/desktop'
import type { PetEvent } from '@shared/pet/types'
import type { PetStatePushPayload, PetWindowContextPayload } from '@shared/ipc/api-types'
import { IPC_EVENT } from '@shared/ipc/channels'
import type { AppLanguage } from '@shared/constants/language'
import { APP_LANGUAGES } from '@shared/constants/language'
import { log } from '../services/logger'
import { resolvePreload } from '../window/preload-path'
import type { LoadedPetPack } from './pack'
import type { JsonStore } from '../services/storage'
import {
  clampPetPosition,
  resolvePetWindowPosition,
  petWindowSize,
  type PetWindowState
} from './window-state'

export interface PetWindowDeps {
  getActiveAgents?: () => number
  getPack: () => LoadedPetPack | null
  getWindowState: () => JsonStore<PetWindowState>
  getSettings: () => DesktopPetSettings
  getLanguage: () => AppLanguage
}

export class PetWindowController {
  private window: BrowserWindow | null = null
  private pack: LoadedPetPack | null = null
  private lastPushAt = 0
  private pendingPush: PetStatePushPayload | null = null
  private pushTimer: NodeJS.Timeout | null = null
  private quitHookInstalled = false
  private clickThrough: boolean | null = null
  private readonly onDisplayChange = (): void => {
    const window = this.window
    if (!window || window.isDestroyed()) return
    try {
      const { x, y, width, height } = window.getBounds()
      const next = clampPetPosition(x, y, width, height)
      if (next.x !== x || next.y !== y) window.setPosition(next.x, next.y, false)
      this.savePosition()
      this.pushConfig()
    } catch (error) {
      log.pet.error('display change failed:', error)
    }
  }

  private detachDisplayListeners(): void {
    screen.removeListener('display-added', this.onDisplayChange)
    screen.removeListener('display-removed', this.onDisplayChange)
    screen.removeListener('display-metrics-changed', this.onDisplayChange)
  }

  constructor(private readonly deps: PetWindowDeps) {}

  setPack(pack: LoadedPetPack | null): void {
    this.pack = pack
    if (pack) this.pushConfig()
  }

  getWebContents(): Electron.WebContents | null {
    return this.window && !this.window.isDestroyed() ? this.window.webContents : null
  }

  getWindowSize(): { width: number; height: number } {
    if (!this.window || this.window.isDestroyed()) return { width: 360, height: 288 }
    const [width, height] = this.window.getSize()
    return { width, height }
  }

  isVisible(): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible())
  }

  /**
   * Ensure the window matches settings (create/show/hide/resize). Never
   * throws — pet failures must not destabilize the host app.
   */
  applySettings(settings: DesktopPetSettings): void {
    try {
      if (!settings.enabled || !this.pack) {
        this.destroy()
        return
      }
      if (!this.window || this.window.isDestroyed()) {
        this.createWindow(settings)
        return
      }
      this.resizeWindow(this.window, settings.size)
      this.window.setOpacity(Math.max(0.3, Math.min(1, settings.opacity)))
      this.window.setAlwaysOnTop(settings.alwaysOnTop, 'floating')
      this.pushConfig()
    } catch (error) {
      log.pet.error('applySettings failed:', error)
    }
  }

  destroy(): void {
    this.detachDisplayListeners()
    if (this.pushTimer) {
      clearTimeout(this.pushTimer)
      this.pushTimer = null
    }
    this.pendingPush = null
    if (this.window && !this.window.isDestroyed()) {
      this.savePosition()
      this.window.destroy()
    }
    this.window = null
  }

  /** Called on app quit — persist position without destroying ordering. */
  savePosition(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      const [x, y] = this.window.getPosition()
      this.persistPosition(x, y)
    }
  }

  private persistPosition(x: number, y: number): void {
    void this.deps
      .getWindowState()
      .write({ x, y })
      .catch((error) => {
        log.pet.error('position save failed:', error)
      })
  }

  private petWindowSize(size: number): { width: number; height: number } {
    const manifest = this.pack?.manifest
    const aspect = manifest ? manifest.baseWidth / Math.max(1, manifest.baseHeight) : 1
    return petWindowSize(size, aspect)
  }

  private createWindow(settings: DesktopPetSettings): void {
    this.clickThrough = null
    const { width, height } = this.petWindowSize(settings.size)
    const position = resolvePetWindowPosition(this.deps.getWindowState(), width, height)
    const window = new BrowserWindow({
      width,
      height,
      x: position.x,
      y: position.y,
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: true,
      show: false,
      skipTaskbar: true,
      focusable: true,
      alwaysOnTop: settings.alwaysOnTop,
      webPreferences: {
        preload: resolvePreload('pet'),
        contextIsolation: true,
        nodeIntegration: false,
        // The compiled preload is ESM, which requires an unsandboxed renderer
        // (same discipline as the screen-motion overlay). The bridge stays
        // narrow: src/preload/pet.ts exposes only pet-scoped channels.
        sandbox: false,
        spellcheck: false
      }
    })
    window.setOpacity(Math.max(0.3, Math.min(1, settings.opacity)))
    window.setAlwaysOnTop(settings.alwaysOnTop, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.on('closed', () => {
      this.detachDisplayListeners()
      this.savePosition()
      this.window = null
    })
    // When the app quits, ensure cleanup (installed once, not per window).
    if (!this.quitHookInstalled) {
      this.quitHookInstalled = true
      app.on('before-quit', () => {
        this.savePosition()
      })
    }
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.showInactive()
    })
    window.webContents.on('render-process-gone', (_e, details) => {
      log.pet.error('pet renderer gone:', details.reason)
    })
    const htmlPath = path.join(__dirname, '../renderer/pet.html')
    void window.loadFile(htmlPath).catch((error) => {
      log.pet.error('pet window load failed:', error)
    })
    this.window = window
    screen.on('display-added', this.onDisplayChange)
    screen.on('display-removed', this.onDisplayChange)
    screen.on('display-metrics-changed', this.onDisplayChange)
    window.webContents.once('did-finish-load', () => {
      this.pushConfig()
    })
  }

  private resizeWindow(window: BrowserWindow, size: number): void {
    const { width, height } = this.petWindowSize(size)
    if (window.getBounds().width === width && window.getBounds().height === height) return
    const [x, y] = window.getPosition()
    const clamped = clampPetPosition(x, y, width, height)
    window.setBounds({ x: clamped.x, y: clamped.y, width, height })
    this.persistPosition(clamped.x, clamped.y)
  }

  /** Renderer-driven drag: move by delta, clamp, persist. */
  moveBy(
    dx: number,
    dy: number
  ): {
    x: number
    y: number
    workArea: { x: number; y: number; width: number; height: number }
  } | null {
    const window = this.window
    if (!window || window.isDestroyed()) return null
    try {
      const [x, y] = window.getPosition()
      const [w, h] = window.getSize()
      const next = clampPetPosition(x + dx, y + dy, w, h)
      if (next.x !== x || next.y !== y) window.setPosition(next.x, next.y, false)
      return { x: next.x, y: next.y, workArea: this.currentWorkArea() }
    } catch (error) {
      log.pet.error('moveBy failed:', error)
      return null
    }
  }

  endDrag(): { workArea: { x: number; y: number; width: number; height: number } } | null {
    const window = this.window
    if (!window || window.isDestroyed()) return null
    this.savePosition()
    return { workArea: this.currentWorkArea() }
  }

  private currentWorkArea(): { x: number; y: number; width: number; height: number } {
    const window = this.window
    if (!window || window.isDestroyed()) {
      const area = screen.getPrimaryDisplay().workArea
      return { ...area }
    }
    const display = screen.getDisplayNearestPoint({
      x: window.getBounds().x,
      y: window.getBounds().y
    })
    return { ...display.workArea }
  }

  setClickThrough(through: boolean): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    if (this.clickThrough === through) return
    try {
      window.setIgnoreMouseEvents(through, { forward: true })
      this.clickThrough = through
      log.pet.debug(`click-through ${through ? 'on' : 'off'}`)
    } catch (error) {
      log.pet.error('setClickThrough failed:', error)
    }
  }

  /** Reset position: center the pet on its current display. */
  resetPosition(): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    try {
      const [width, height] = window.getSize()
      const bounds = window.getBounds()
      const display = screen.getDisplayNearestPoint(bounds)
      const area = display.workArea
      const x = Math.round(area.x + Math.max(0, (area.width - width) / 2))
      const y = Math.round(area.y + Math.max(0, (area.height - height) / 2))
      if (bounds.x !== x || bounds.y !== y) window.setPosition(x, y, false)
      this.persistPosition(x, y)
      log.pet.info('pet position reset')
    } catch (error) {
      log.pet.error('resetPosition failed:', error)
    }
  }

  /** Push fresh context (manifest/settings/language) into the pet renderer. */
  pushConfig(): void {
    const window = this.window
    const pack = this.pack
    if (!window || window.isDestroyed() || !pack) return
    const settings = this.deps.getSettings()
    const [width, height] = window.getSize()
    const payload: PetWindowContextPayload = {
      activeAgents: this.deps.getActiveAgents?.() ?? 0,
      manifest: pack.manifest,
      settings,
      language: normalizeLanguage(this.deps.getLanguage()),
      width,
      height
    }
    try {
      window.webContents.send(IPC_EVENT.petConfig, payload)
    } catch (error) {
      log.pet.error('pushConfig failed:', error)
    }
  }

  /**
   * Queue normalized pet events for delivery. Events are coalesced on a
   * short timer (PET_EVENT_MERGE_MS-like debounce) so bursts of agent
   * streaming events do not flood the pet renderer.
   */
  pushState(events: PetEvent[], activeAgents: number): void {
    if (!this.isVisible()) return
    this.pendingPush = {
      events: [...(this.pendingPush?.events ?? []), ...events].slice(-50),
      activeAgents
    }
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      const payload = this.pendingPush
      this.pendingPush = null
      if (!payload) return
      const window = this.window
      if (!window || window.isDestroyed()) return
      this.lastPushAt = Date.now()
      try {
        window.webContents.send(IPC_EVENT.petState, payload)
      } catch (error) {
        log.pet.error('pushState failed:', error)
      }
    }, 80)
    this.pushTimer.unref?.()
  }

  /** For diagnostics. */
  describe(): { visible: boolean; lastPushAt: number } {
    return { visible: this.isVisible(), lastPushAt: this.lastPushAt }
  }
}

function normalizeLanguage(value: AppLanguage): AppLanguage {
  return (APP_LANGUAGES as readonly string[]).includes(value) ? value : 'en-US'
}
