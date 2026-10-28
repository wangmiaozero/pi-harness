/**
 * Integration tests for the PetService pack-switching paths. The Electron
 * window layer and protocol handler are stubbed; the pack registry, pack
 * loader and on-disk fixtures are real (temp directories).
 *
 * Regression coverage: `setActivePack` used to pre-assign `this.settings`
 * before delegating to `applySettings`, which defeated applySettings's own
 * switch detection — the new pack was never loaded and the caller received
 * a spurious "could not be loaded" error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '@shared/ipc/api-types'
import { ipcMain } from 'electron'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { BIGFISH_CLIPS } from '@shared/pet/desktop'
import { JsonStore } from '../services/storage'
import { normalizeDesktopPetSettings } from '@shared/pet/desktop'
import { createPackDir, type PackFixtureOptions } from './test-fixtures'

const petWindowStubs = vi.hoisted(() => ({
  setPack: vi.fn(),
  applySettings: vi.fn(),
  destroy: vi.fn(),
  getWebContents: vi.fn(() => null),
  getWindowSize: vi.fn(() => ({ width: 294, height: 235 })),
  pushState: vi.fn(),
  pushConfig: vi.fn()
}))

const bridgeStubs = vi.hoisted(() => ({
  attach: vi.fn(),
  detach: vi.fn(),
  pushState: vi.fn(),
  dispose: vi.fn()
}))

const protocolStubs = vi.hoisted(() => ({
  installPetProtocolHandler: vi.fn(),
  registerPetScheme: vi.fn()
}))

const bundledRootHolder = vi.hoisted(() => ({ root: '' }))

vi.mock('./pet-window', () => ({
  PetWindowController: vi.fn(function PetWindowController() {
    return petWindowStubs
  })
}))

vi.mock('./events', () => ({
  PetEventBridge: vi.fn(function PetEventBridge() {
    return bridgeStubs
  })
}))

vi.mock('./protocol', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./protocol')>()
  return {
    ...actual,
    installPetProtocolHandler: protocolStubs.installPetProtocolHandler,
    registerPetProtocolScheme: protocolStubs.registerPetScheme
  }
})

vi.mock('./pack', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pack')>()
  return {
    ...actual,
    bundledPetPackRoot: () => bundledRootHolder.root
  }
})

const electronStubs = vi.hoisted(() => ({ userDataPath: '/tmp/pet-service-userdata' }))

vi.mock('electron', () => ({
  app: { getLocale: () => 'zh-CN' },
  screen: {
    getAllDisplays: () => [],
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}))

const { PetWindowController } = await import('./pet-window')
const { PetService } = await import('./service')
const { PetPackRegistry } = await import('./registry')
const { initAppPaths } = await import('../services/app-paths')

const REQUIRED_BUNDLED_CLIPS = BIGFISH_CLIPS.slice(0, 10)

describe('PetService pack switching', () => {
  let sandbox = ''
  let bundledRoot = ''
  let userRoot = ''
  let settingsStore: JsonStore<AppSettings>
  let service: InstanceType<typeof PetService>

  const makePackOptions = (id: string): PackFixtureOptions => ({
    id,
    frames: 2,
    ...(id === 'bigfish'
      ? { extraClips: REQUIRED_BUNDLED_CLIPS.slice(1).map((name) => ({ name })) }
      : {})
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-service-'))
    electronStubs.userDataPath = path.join(sandbox, 'userdata')
    initAppPaths({
      getPath: (name: string) => (name === 'userData' ? electronStubs.userDataPath : sandbox),
      isPackaged: false
    } as never)
    bundledRoot = path.join(sandbox, 'bundled')
    userRoot = path.join(sandbox, 'user-packs')
    bundledRootHolder.root = bundledRoot
    await fs.mkdir(path.join(bundledRoot, 'bigfish'), { recursive: true })
    await fs.mkdir(userRoot, { recursive: true })
    await createPackDir(bundledRoot, makePackOptions('bigfish'))
    settingsStore = new JsonStore<AppSettings>(
      path.join(sandbox, 'app-settings.json'),
      {} as AppSettings
    )
    service = new PetService(settingsStore, userRoot, {
      openMain: () => undefined,
      onQuitRequest: () => undefined
    })
    await service.start()
  })

  // write() sets the store cache synchronously; peek() observes it without
  // racing the async disk flush.
  const persistedDesktopPet = (): AppSettings['desktopPet'] => settingsStore.peek().desktopPet

  afterEach(async () => {
    // persistSettings fires void-write()s; let them finish before removing
    // the sandbox, otherwise the atomic write's rename races the rm.
    await new Promise((resolve) => setTimeout(resolve, 50))
    await fs.rm(sandbox, { recursive: true, force: true, maxRetries: 3 })
  })

  const enablePet = async (): Promise<void> => {
    await service.applySettings({
      enabled: true,
      activePackId: 'bigfish'
    })
    // Mirror what the settings UI persists when enabling the pet, so tests
    // that assert "settings intact after failure" have a baseline.
    await settingsStore.write({
      ...settingsStore.peek(),
      desktopPet: normalizeDesktopPetSettings({ enabled: true, activePackId: 'bigfish' })
    } as AppSettings)
  }

  const userPackFixture = async (): Promise<string> => {
    const staging = path.join(sandbox, 'incoming', 'samplepet')
    await fs.mkdir(path.dirname(staging), { recursive: true })
    await createPackDir(path.dirname(staging), { id: 'samplepet', frames: 2 })
    return staging
  }

  it('loads the newly selected pack when switching while enabled', async () => {
    await enablePet()
    expect(service.currentManifest()?.id).toBe('bigfish')
    petWindowStubs.setPack.mockClear()

    const incoming = await userPackFixture()
    await service.importPack({ kind: 'directory', path: incoming })
    await service.setActivePack('samplepet')

    expect(service.currentManifest()?.id).toBe('samplepet')
    expect(petWindowStubs.setPack).toHaveBeenCalled()
    const settings = persistedDesktopPet()
    expect(settings?.activePackId).toBe('samplepet')
    expect(settings?.enabled).toBe(true)
  })

  it('falls back to the bundled pack when the active pack is removed while enabled', async () => {
    await enablePet()
    const incoming = await userPackFixture()
    await service.importPack({ kind: 'directory', path: incoming })
    await service.setActivePack('samplepet')
    expect(service.currentManifest()?.id).toBe('samplepet')
    petWindowStubs.setPack.mockClear()

    await service.removePack('samplepet')

    expect(service.currentManifest()?.id).toBe('bigfish')
    expect(petWindowStubs.setPack).toHaveBeenCalled()
    expect(persistedDesktopPet()?.activePackId).toBe('bigfish')
  })

  it('reloads the active pack from disk when it is re-imported (update)', async () => {
    await enablePet()
    const incoming = await userPackFixture()
    await service.importPack({ kind: 'directory', path: incoming })
    await service.setActivePack('samplepet')

    // Bump the version on disk and re-import the same pack id.
    const updated = path.join(sandbox, 'updated', 'samplepet')
    await fs.mkdir(path.dirname(updated), { recursive: true })
    await createPackDir(path.dirname(updated), { id: 'samplepet', frames: 3, version: '0.2.0' })

    const result = await service.importPack({ kind: 'directory', path: updated })

    expect(result.previousVersion).toBe('1.0.0')
    expect(service.currentManifest()?.version).toBe('0.2.0')
  })

  it('restores the previous settings when the switch target disappears before switching', async () => {
    await enablePet()
    const incoming = await userPackFixture()
    await service.importPack({ kind: 'directory', path: incoming })
    // The pack vanishes between import and the switch (disk-level failure).
    await fs.rm(path.join(userRoot, 'samplepet'), { recursive: true, force: true })

    await expect(service.setActivePack('samplepet')).rejects.toThrow()
    // No black window: the bundled pack stays loaded and settings are intact.
    expect(service.currentManifest()?.id).toBe('bigfish')
    expect(persistedDesktopPet()?.activePackId).toBe('bigfish')
  })

  it('does not load any pack while the pet stays disabled', async () => {
    expect(service.currentManifest()).toBeNull()
    expect(petWindowStubs.setPack).not.toHaveBeenCalled()
    const incoming = await userPackFixture()
    await service.importPack({ kind: 'directory', path: incoming })
    await service.setActivePack('samplepet')
    expect(service.currentManifest()).toBeNull()
    expect(persistedDesktopPet()?.activePackId).toBe('samplepet')
    expect(petWindowStubs.setPack).not.toHaveBeenCalled()
  })

  it('starts with the saved application language and resolves auto against the system locale', async () => {
    const currentLanguage = () => vi.mocked(PetWindowController).mock.calls.at(-1)![0].getLanguage()
    expect(currentLanguage()).toBe('zh-CN')
    service.setLanguage('ja-JP')
    expect(currentLanguage()).toBe('ja-JP')
    expect(petWindowStubs.pushConfig).toHaveBeenCalled()
    service.setLanguage('auto')
    expect(currentLanguage()).toBe('zh-CN')
    await settingsStore.write({ ...settingsStore.peek(), language: 'zh-TW' })
    new PetService(settingsStore, userRoot, { openMain: () => {}, onQuitRequest: () => {} })
    expect(currentLanguage()).toBe('zh-TW')
  })

  it('blocks all menu actions during tasks independently of animation sync and unlocks afterwards', async () => {
    const openMain = vi.fn()
    const quit = vi.fn()
    service = new PetService(settingsStore, userRoot, { openMain, onQuitRequest: quit })
    await service.start()
    let running = ['session-a', 'session-b']
    service.attachAgent({ onEvent: () => () => {}, listRunning: () => running }, null)
    await service.applySettings({ enabled: true, agentSync: false })
    const sender = { isDestroyed: () => false }
    petWindowStubs.getWebContents.mockReturnValue(sender as never)
    const invoke = vi
      .mocked(ipcMain.handle)
      .mock.calls.filter(([channel]) => channel === IPC_INVOKE.petMenuAction)
      .at(-1)![1]
    const getContext = vi
      .mocked(ipcMain.handle)
      .mock.calls.filter(([channel]) => channel === IPC_INVOKE.petGetContext)
      .at(-1)![1]
    expect(await getContext({ sender } as never)).toMatchObject({ activeAgents: 2 })
    const before = settingsStore.peek()
    const destroys = petWindowStubs.destroy.mock.calls.length
    for (const action of [
      'open-main',
      'open-settings',
      'toggle-always-on-top',
      'toggle-reduced-motion',
      'reset-position',
      'hide',
      'quit'
    ]) {
      await invoke({ sender } as never, action)
    }
    expect(openMain).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
    expect(settingsStore.peek()).toEqual(before)
    expect(petWindowStubs.destroy).toHaveBeenCalledTimes(destroys)
    running = []
    await invoke({ sender } as never, 'open-settings')
    expect(openMain).toHaveBeenCalledWith('settings')
  })

  it('exposes the registry roots used for pack lookup', () => {
    const registry = new PetPackRegistry(bundledRoot, userRoot)
    expect(registry.userPacksRoot).toBe(userRoot)
  })
})
