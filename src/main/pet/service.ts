/**
 * Desktop pet service facade — owns the pack registry, the window controller,
 * the event bridge and the pet-scoped IPC handlers.
 *
 * IPC discipline: pet window handlers are registered on raw ipcMain with an
 * explicit sender check against the pet window's webContents (NOT the
 * trusted-ipc wrapper, which only allows the main window). Failures inside
 * the pet subsystem are contained: they must never destabilize the host app.
 *
 * Lazy by default: the desktop pet ships disabled and no pack is loaded, no
 * window is created and no frame is read until the user explicitly enables
 * it. Turning the pet off destroys the window immediately, releases the pack
 * reference and detaches the agent event bridge.
 */

import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import type { DesktopPetSettings, PetPackManifest } from '@shared/pet/desktop'
import { BUNDLED_PACK_ID, normalizeDesktopPetSettings } from '@shared/pet/desktop'
import { resolveAppLocale, type AppLanguage, type AppLocale } from '@shared/constants/language'
import type { AppSettings } from '@shared/ipc/api-types'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { log } from '../services/logger'
import type { JsonStore } from '../services/storage'
import {
  bundledPetPackRoot,
  loadPetPack,
  packCoversRequiredStates,
  type LoadedPetPack
} from './pack'
import {
  PetPackRegistry,
  PetPackError,
  type PetPackDetail,
  type PetPackInstallResult,
  type PetPackInstallSource,
  type PetPackSummary
} from './registry'
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
  onSettingsChanged?: () => void
  openMain: (view: 'main' | 'settings') => void
  onQuitRequest: () => void
}

export type PetPermissionHook = (listener: (toolName: string) => void) => () => void

export class PetService {
  private readonly controller: PetWindowController
  private readonly bridge: PetEventBridge
  private readonly registry: PetPackRegistry
  private readonly windowState = createPetWindowStateStore()
  private pack: LoadedPetPack | null = null
  /** Pack id currently loaded into `this.pack` (null = nothing loaded). */
  private loadedPackId: string | null = null
  /** Serializes enable/disable/switch transitions. */
  private applyQueue: Promise<void> = Promise.resolve()
  private settings: DesktopPetSettings
  private language: AppLocale
  private readonly menuCallbacks: PetMenuCallbacks
  private started = false
  private agentSource: PetEventAgentSource | null = null
  private detachPermissionHook: (() => void) | null = null

  constructor(
    private readonly settingsStore: JsonStore<AppSettings>,
    private readonly userPackRoot: string,
    menuCallbacks: PetMenuCallbacks
  ) {
    this.language = resolveAppLocale(settingsStore.peek().language ?? 'auto', app.getLocale())
    this.settings = this.readSettings()
    this.registry = new PetPackRegistry(bundledPetPackRoot(__dirname), userPackRoot)
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
  attachAgent(source: PetEventAgentSource | null, permissionHook: PetPermissionHook | null): void {
    this.agentSource = source
    this.detachPermissionHook?.()
    this.detachPermissionHook = null
    if (source && this.settings.enabled) this.bridge.attach(source)
    if (permissionHook) {
      this.detachPermissionHook = permissionHook((toolName) => {
        this.controller.pushState([{ type: 'WAITING_FOR_USER', waiting: true }], 1)
        log.pet.debug('permission requested:', toolName)
      })
    }
  }

  /**
   * Call after app ready: install the protocol handler and apply settings.
   * With the pet disabled (the default) this loads no pack and creates no
   * window — the service stays a lightweight settings reader.
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    try {
      installPetProtocolHandler([this.registry.userPacksRoot, bundledPetPackRoot(__dirname)])
      this.registerIpc()
      await this.applySettings(this.settings)
      log.pet.info('desktop pet service started', { enabled: this.settings.enabled })
    } catch (error) {
      log.pet.error('desktop pet failed to start:', error)
    }
  }

  /** App quit: fully tear down the pet subsystem. */
  stop(): void {
    this.bridge.dispose()
    this.detachPermissionHook?.()
    this.detachPermissionHook = null
    this.controller.savePosition()
    this.controller.destroy()
    this.pack = null
    this.loadedPackId = null
  }

  /** Settings changed (from SettingsView or the pet menu) — re-apply. */
  async applySettings(next: unknown): Promise<void> {
    const previous = this.settings
    const normalized = normalizeDesktopPetSettings(next)
    this.settings = normalized
    const run = this.applyQueue.then(async () => {
      try {
        if (!normalized.enabled) {
          // Disabled: destroy window, release pack resources, detach agent
          // listeners. No animation work happens afterwards.
          this.pack = null
          this.loadedPackId = null
          this.bridge.dispose()
          this.controller.destroy()
          return
        }
        if (this.agentSource) this.bridge.attach(this.agentSource)
        const switched = previous.activePackId !== normalized.activePackId || !this.pack
        if (switched) {
          const loaded = await this.loadPackById(normalized.activePackId)
          if (!loaded) return // loadPackById already restored a fallback pack
        }
        this.controller.setPack(this.pack)
        this.controller.applySettings(this.settings)
        if (previous.enabled !== normalized.enabled) {
          log.pet.info('desktop pet toggled', { enabled: normalized.enabled })
        }
      } catch (error) {
        log.pet.error('applySettings failed:', error)
      }
    })
    this.applyQueue = run.catch(() => undefined)
    await run
  }

  setLanguage(language: AppLanguage): void {
    this.language = resolveAppLocale(language, app.getLocale())
    this.controller.pushConfig()
  }

  resetPosition(): void {
    this.controller.resetPosition()
  }

  // ------------------------------------------------------------------
  // Pack management (main-window IPC surface, see src/main/ipc/register.ts)
  // ------------------------------------------------------------------

  listPacks(): Promise<PetPackSummary[]> {
    return this.registry.list()
  }

  packDetail(id: string): Promise<PetPackDetail | null> {
    return this.registry.detail(id)
  }

  /**
   * Import a pack. Never changes `enabled` — importing while the pet is off
   * must not create a window or turn the pet on.
   */
  async importPack(source: PetPackInstallSource): Promise<PetPackInstallResult> {
    const result = await this.registry.install(source)
    log.pet.info('pet pack imported', result)
    if (this.settings.enabled && this.settings.activePackId === result.id) {
      // Updating the running pack: drop the in-memory copy so applySettings
      // reloads the new files from disk (applySettings only reloads when the
      // active pack id changes).
      this.pack = null
      this.loadedPackId = null
      await this.applySettings({ ...this.settings, activePackId: result.id })
    }
    return result
  }

  /**
   * Remove a user-installed pack. Removing the active pack falls back to the
   * bundled pet; the window follows the `enabled` setting.
   */
  async removePack(id: string): Promise<void> {
    await this.registry.remove(id)
    log.pet.info('pet pack removed', { id })
    if (this.settings.activePackId === id) {
      const next = { ...this.settings, activePackId: BUNDLED_PACK_ID }
      // applySettings first — persistSettings assigns this.settings, and
      // pre-assigning would defeat applySettings's switch detection (the
      // bundled pack would never be reloaded).
      await this.applySettings(next)
      this.persistSettings(next)
    }
  }

  /**
   * Select the active pack. With the pet enabled this swaps the pack live;
   * on failure the previous pack keeps running and the error propagates to
   * the caller (Settings UI) so the user knows nothing broke silently.
   */
  async setActivePack(id: string): Promise<PetPackDetail | null> {
    const detail = await this.registry.detail(id)
    if (!detail) throw new PetPackError(`Pet pack "${id}" is not installed`)
    const previous = this.settings
    if (previous.activePackId === id) return detail
    const next = { ...previous, activePackId: id }
    // Do NOT pre-assign this.settings — applySettings detects the switch by
    // comparing its own previous settings with the patch. Assigning early
    // made the live load a no-op and the caller see "could not be loaded".
    try {
      if (previous.enabled) {
        await this.applySettings(next)
        if (!this.pack || this.loadedPackId !== id) {
          throw new PetPackError(`Pet pack "${id}" could not be loaded`)
        }
      }
      this.persistSettings(next)
      return detail
    } catch (error) {
      // Restore the previous pack so no black pet window is left behind.
      await this.applySettings(previous)
      throw error instanceof Error ? error : new PetPackError(String(error))
    }
  }

  /** Pack manifest actually running right now (null when disabled/unloaded). */
  currentManifest(): PetPackManifest | null {
    return this.pack?.manifest ?? null
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Load the pack with the given id (user packs first, then bundled). Falls
   * back to the bundled pet when the requested pack is broken, and leaves
   * the previously running pack untouched on a live-switch failure.
   */
  private async loadPackById(id: string): Promise<boolean> {
    if (this.loadedPackId === id && this.pack) return true
    const previousPack = this.pack
    const previousId = this.loadedPackId
    const root = await this.registry.findPackRoot(id)
    if (!root) {
      log.pet.error('pet pack not found:', id)
      return this.fallbackToBundled(previousPack, previousId, id)
    }
    try {
      const pack = await loadPetPack(root)
      if (id === BUNDLED_PACK_ID && !packCoversRequiredStates(pack.manifest)) {
        throw new PetPackError('bundled pack is missing required clips')
      }
      this.pack = pack
      this.loadedPackId = pack.manifest.id
      log.pet.info('pet pack loaded', {
        id: pack.manifest.id,
        clips: Object.keys(pack.manifest.clips).length
      })
      return true
    } catch (error) {
      log.pet.error(`pet pack "${id}" failed to load:`, error)
      return this.fallbackToBundled(previousPack, previousId, id)
    }
  }

  /** Keep the previous pack running, or fall back to the bundled pet. */
  private async fallbackToBundled(
    previousPack: LoadedPetPack | null,
    previousId: string | null,
    requestedId: string
  ): Promise<boolean> {
    if (previousPack && previousId) {
      this.pack = previousPack
      this.loadedPackId = previousId
      this.settings = { ...this.settings, activePackId: previousId }
      this.persistSettings(this.settings)
      log.pet.warn(`kept running pack "${previousId}" after failed switch to "${requestedId}"`)
      return false
    }
    if (requestedId !== BUNDLED_PACK_ID) {
      const root = await this.registry.findPackRoot(BUNDLED_PACK_ID)
      if (root) {
        try {
          const pack = await loadPetPack(root)
          this.pack = pack
          this.loadedPackId = BUNDLED_PACK_ID
          this.settings = { ...this.settings, activePackId: BUNDLED_PACK_ID }
          this.persistSettings(this.settings)
          return true
        } catch (error) {
          log.pet.error('bundled pet pack unavailable:', error)
        }
      }
    }
    this.pack = null
    this.loadedPackId = null
    return false
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
          return this.handleMenuAction(args[0])
        }
        default:
          return undefined
      }
    } catch (error) {
      log.pet.error('pet IPC failed:', channel, error)
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  private async handleMenuAction(action: unknown): Promise<void> {
    switch (action) {
      case 'open-main':
        this.menuCallbacks.openMain('main')
        break
      case 'open-settings':
        this.menuCallbacks.openMain('settings')
        break
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
      case 'hide': {
        const next = { ...this.settings, enabled: false }
        await this.applySettings(next)
        this.persistSettings(next)
        break
      }
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
      void this.settingsStore
        .write({ ...current, desktopPet: next })
        .then(() => this.menuCallbacks.onSettingsChanged?.())
        .catch((error) => log.pet.error('failed to persist pet settings:', error))
    } catch (error) {
      log.pet.error('failed to persist pet settings:', error)
    }
    this.controller.applySettings(next)
  }
}

/** Directory used for user-imported packs (kept in sync with registry). */
export function userPetPacksRoot(userDataDir: string): string {
  return path.join(userDataDir, 'petpacks')
}
