/**
 * Desktop pet service facade — owns the pack, the window controller, the
 * event bridge and the pet-scoped IPC handlers.
 *
 * IPC discipline: pet window handlers are registered on raw ipcMain with an
 * explicit sender check against the pet window's webContents (NOT the
 * trusted-ipc wrapper, which only allows the main window). Failures inside
 * the pet subsystem are contained: they must never destabilize the host app.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import type { DesktopPetSettings } from '@shared/pet/desktop'
import { normalizeDesktopPetSettings } from '@shared/pet/desktop'
import type { AppLanguage } from '@shared/constants/language'
import type { AppSettings } from '@shared/ipc/api-types'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { log } from '../services/logger'
import type { JsonStore } from '../services/storage'
import { bundledPetPackRoot, loadPetPack, packCoversRequiredStates, type LoadedPetPack } from './pack'
import { installPetProtocolHandler, registerPetProtocolScheme } from './protocol'
import { PetWindowController } from './pet-window'
import { PetEventBridge, type PetEventAgentSource } from './events'
import { createPetWindowStateStore } from './window-state'

export type { PetEventAgentSource }

const PET_SENDER_CHANNELS = [
  IPC_INVOKE.petGetContext,
  IPC_INVOKE.petMoveBy,
  IPC_INVOKE.petEndDrag,
  IPC_INVOKE.petSetClickThrough,
  IPC_INVOKE.petOpenMain,
  IPC_INVOKE.petMenuAction
] as const

type PetSenderChannel = (typeof PET_SENDER_CHANNELS)[number]

export interface PetMenuCallbacks {
  openMain: (view: 'main' | 'settings') => void
  onQuitRequest: () => void
}

export type PetPermissionHook = (
  listener: (toolName: string) => void
) => () => void

export class PetService {
  private readonly controller: PetWindowController
  private readonly bridge: PetEventBridge
  private readonly windowState = createPetWindowStateStore()
  private pack: LoadedPetPack | null = null
  private loadPromise: Promise<void> | null = null
  private settings: DesktopPetSettings
  private language: AppLanguage = 'en-US'
  private readonly menuCallbacks: PetMenuCallbacks
  private started = false

  constructor(
    private readonly settingsStore: JsonStore<AppSettings>,
    menuCallbacks: PetMenuCallbacks
  ) {
    this.settings = this.readSettings()
    this.controller = new PetWindowController({
      getPack: () => this.pack,
      getWindowState: () => this.windowState,
      getSettings: () => this.settings,
      getLanguage: () => this.language
    })
    this.bridge = new PetEventBridge(this.controller, () => this.settings.agentSync)
    this.menuCallbacks = menuCallbacks
  }

  /** Call before app ready (alongside other privileged scheme registration). */
  static registerScheme(): void {
    registerPetProtocolScheme()
  }

  /** Wire the agent runtime the pet reacts to. Call before start(). */
  attachAgent(
    source: PetEventAgentSource | null,
    permissionHook: PetPermissionHook | null
  ): void {
    if (source) this.bridge.attach(source)
    if (permissionHook) {
      permissionHook((toolName) => {
        this.controller.pushState([{ type: 'WAITING_FOR_USER', waiting: true }], 1)
        log.pet.debug('permission requested:', toolName)
      })
    }
  }

  /** Call after app ready: install protocol, load the pack, apply settings. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    try {
      installPetProtocolHandler(bundledPetPackRoot(__dirname))
      await this.loadPack()
      this.controller.applySettings(this.settings)
      this.registerIpc()
      log.pet.info('desktop pet service started', { enabled: this.settings.enabled })
    } catch (error) {
      log.pet.error('desktop pet failed to start:', error)
    }
  }

  stop(): void {
    this.bridge.dispose()
    this.controller.savePosition()
    this.controller.destroy()
  }

  /** Settings changed (from SettingsView or the pet menu) — re-apply. */
  applySettings(next: unknown): void {
    const wasEnabled = this.settings.enabled
    this.settings = normalizeDesktopPetSettings(next)
    if (!this.loadPromise) return
    void this.loadPromise.then(() => {
      this.controller.applySettings(this.settings)
      if (wasEnabled !== this.settings.enabled) {
        log.pet.info('desktop pet toggled', { enabled: this.settings.enabled })
      }
    })
  }

  setLanguage(language: AppLanguage): void {
    this.language = language
    this.controller.pushConfig()
  }

  resetPosition(): void {
    this.controller.resetPosition()
  }

  private async loadPack(): Promise<void> {
    const parent = bundledPetPackRoot(__dirname)
    const packRoot = path.join(parent, 'bigfish')
    try {
      const pack = await loadPetPack(packRoot)
      if (!packCoversRequiredStates(pack.manifest)) {
        throw new Error('bundled pack is missing required clips')
      }
      this.pack = pack
      this.controller.setPack(pack)
      log.pet.info('pet pack loaded', {
        id: pack.manifest.id,
        clips: Object.keys(pack.manifest.clips).length
      })
    } catch (error) {
      this.pack = null
      log.pet.error('pet pack unavailable, desktop pet disabled:', error)
    }
  }

  private readSettings(): DesktopPetSettings {
    const stored = this.settingsStore.peek()
    return normalizeDesktopPetSettings(stored.desktopPet)
  }

  private isPetSender(event: IpcMainInvokeEvent): boolean {
    const sender = this.controller.getWebContents()
    return Boolean(sender && !sender.isDestroyed() && event.sender === sender)
  }

  private registerIpc(): void {
    for (const channel of PET_SENDER_CHANNELS) {
      ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
        if (!this.isPetSender(event)) {
          throw new Error('pet IPC restricted to the pet window')
        }
        return this.handlePetInvoke(channel, args)
      })
    }
  }

  private handlePetInvoke(channel: PetSenderChannel, args: unknown[]): unknown {
    try {
      switch (channel) {
        case IPC_INVOKE.petGetContext: {
          const pack = this.pack
          if (!pack) throw new Error('pet pack unavailable')
          const size = this.controller.getWindowSize()
          return {
            manifest: pack.manifest,
            settings: this.settings,
            language: this.language,
            width: size.width,
            height: size.height
          }
        }
        case IPC_INVOKE.petMoveBy: {
          const payload = args[0] as { dx?: unknown; dy?: unknown } | undefined
          const dx = Number(payload?.dx)
          const dy = Number(payload?.dy)
          if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
          return this.controller.moveBy(
            Math.max(-400, Math.min(400, dx)),
            Math.max(-400, Math.min(400, dy))
          )
        }
        case IPC_INVOKE.petEndDrag:
          return this.controller.endDrag()
        case IPC_INVOKE.petSetClickThrough:
          this.controller.setClickThrough(args[0] === true)
          return undefined
        case IPC_INVOKE.petOpenMain: {
          const view = args[0] === 'settings' ? 'settings' : 'main'
          this.menuCallbacks.openMain(view)
          return undefined
        }
        case IPC_INVOKE.petMenuAction: {
          this.handleMenuAction(args[0])
          return undefined
        }
        default:
          return undefined
      }
    } catch (error) {
      log.pet.error('pet IPC failed:', channel, error)
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  private handleMenuAction(action: unknown): void {
    switch (action) {
      case 'toggle-always-on-top': {
        this.persistSettings({ ...this.settings, alwaysOnTop: !this.settings.alwaysOnTop })
        break
      }
      case 'toggle-reduced-motion': {
        this.persistSettings({ ...this.settings, reducedMotion: !this.settings.reducedMotion })
        break
      }
      case 'reset-position':
        this.controller.resetPosition()
        break
      case 'hide':
        this.persistSettings({ ...this.settings, enabled: false })
        break
      case 'quit':
        this.menuCallbacks.onQuitRequest()
        break
      default:
        log.pet.warn('unknown pet menu action', { action: String(action) })
    }
  }

  /** Persist pet settings through the shared store so the Settings UI stays in sync. */
  private persistSettings(next: DesktopPetSettings): void {
    this.settings = next
    try {
      const current = this.settingsStore.peek()
      void this.settingsStore.write({ ...current, desktopPet: next })
    } catch (error) {
      log.pet.error('failed to persist pet settings:', error)
    }
    this.controller.applySettings(next)
  }
}
