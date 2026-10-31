import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DESKTOP_PET_SETTINGS } from '@shared/pet/desktop'
import type { LoadedPetPack } from './pack'
import type { JsonStore } from '../services/storage'
import type { PetWindowState } from './window-state'
import { PetWindowController } from './pet-window'

const mocks = vi.hoisted(() => ({
  createWindow: vi.fn(),
  displayChange: null as (() => void) | null,
  area: { x: 0, y: 0, width: 1000, height: 800 }
}))
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function (bounds) {
    return mocks.createWindow(bounds)
  }),
  app: { on: vi.fn() },
  screen: {
    getAllDisplays: () => [{ workArea: mocks.area }],
    getPrimaryDisplay: () => ({ workArea: mocks.area }),
    getDisplayNearestPoint: () => ({ workArea: mocks.area }),
    on: (event: string, listener: () => void) => {
      if (event === 'display-metrics-changed') mocks.displayChange = listener
    },
    removeListener: vi.fn()
  }
}))

function nativeWindow(bounds: { x: number; y: number; width: number; height: number }) {
  const events = new EventEmitter()
  let destroyed = false
  return Object.assign(events, {
    webContents: { on: vi.fn(), once: vi.fn(), send: vi.fn() },
    isDestroyed: () => destroyed,
    isVisible: () => !destroyed,
    setOpacity: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    showInactive: vi.fn(),
    loadFile: vi.fn().mockResolvedValue(undefined),
    getBounds: () => ({ ...bounds }),
    getPosition: () => [bounds.x, bounds.y],
    getSize: () => [bounds.width, bounds.height],
    setIgnoreMouseEvents: vi.fn(),
    setPosition: vi.fn((x: number, y: number) => Object.assign(bounds, { x, y })),
    destroy: () => {
      destroyed = true
      events.emit('closed')
    }
  })
}

describe('pet native window updates', () => {
  const settings = { ...DEFAULT_DESKTOP_PET_SETTINGS, enabled: true }
  let controller: PetWindowController
  let window: ReturnType<typeof nativeWindow>

  beforeEach(() => {
    mocks.createWindow.mockImplementation((bounds) => {
      window = nativeWindow(bounds)
      return window
    })
    const store = { peek: () => ({ x: 0, y: 0 }), write: vi.fn().mockResolvedValue(undefined) }
    controller = new PetWindowController({
      getPack: () => null,
      getWindowState: () => store as unknown as JsonStore<PetWindowState>,
      getSettings: () => settings,
      getLanguage: () => 'zh-CN'
    })
    controller.setPack({
      root: '/fixture',
      manifest: { baseWidth: 1, baseHeight: 1 }
    } as LoadedPetPack)
    controller.applySettings(settings)
  })
  afterEach(() => controller.destroy())

  it('updates click-through only on transitions and reapplies it to a recreated window', () => {
    controller.setClickThrough(false)
    controller.setClickThrough(false)
    controller.setClickThrough(true)
    controller.setClickThrough(true)
    expect(window.setIgnoreMouseEvents.mock.calls).toEqual([
      [false, { forward: true }],
      [true, { forward: true }]
    ])
    controller.destroy()
    controller.applySettings(settings)
    controller.setClickThrough(true)
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledOnce()
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
  })

  it('allows retry when the native click-through update fails', () => {
    window.setIgnoreMouseEvents.mockImplementationOnce(() => {
      throw new Error('Native fixture failure')
    })
    controller.setClickThrough(true)
    controller.setClickThrough(true)
    controller.setClickThrough(true)
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledTimes(2)
  })

  it('skips unchanged drag, edge clamping, display and reset positions while retaining real moves', () => {
    const unchanged = controller.moveBy(0, 0)
    expect(unchanged).toMatchObject({ x: 0, y: 0 })
    controller.moveBy(-100, -100)
    mocks.displayChange?.()
    expect(window.setPosition).not.toHaveBeenCalled()
    expect(controller.moveBy(40, 50)).toMatchObject({ x: 40, y: 50 })
    expect(window.setPosition).toHaveBeenCalledOnce()
    controller.resetPosition()
    expect(window.setPosition).toHaveBeenCalledTimes(2)
    controller.resetPosition()
    expect(window.setPosition).toHaveBeenCalledTimes(2)
    window.setPosition(-500, -500)
    window.setPosition.mockClear()
    mocks.displayChange?.()
    expect(window.getPosition()).toEqual([0, 0])
    expect(window.setPosition).toHaveBeenCalledOnce()
  })
})
