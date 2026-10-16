import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { installArchitectureFullscreen } from './architecture-fullscreen'

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'fullscreenElement')
})

function fixture() {
  vi.stubGlobal('process', { ...process, platform: 'darwin' })
  let element: Element | null = null
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element })
  const panel = document.createElement('div')
  panel.id = 'pi-architecture-panel'
  const contents = Object.assign(new EventEmitter(), {
    executeJavaScript: vi.fn(async (source: string) =>
      // Execute the real DOM query, including its fullscreenchange listener.
      new Function('document', `return (${source})`)(document)
    )
  })
  let simple = false
  const win = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => false,
    isFullScreen: () => false,
    isSimpleFullScreen: () => simple,
    setSimpleFullScreen: vi.fn((value: boolean) => {
      simple = value
    })
  })
  installArchitectureFullscreen(win as unknown as BrowserWindow)
  return {
    win,
    contents,
    commit: (value: boolean) => {
      element = value ? panel : null
      document.dispatchEvent(new Event('fullscreenchange'))
    }
  }
}

it('enters the native window when HTML fullscreen commits after the main event, including re-entry', async () => {
  const { win, contents, commit } = fixture()
  for (let cycle = 0; cycle < 2; cycle++) {
    contents.emit('enter-html-full-screen')
    await Promise.resolve()
    expect(win.isSimpleFullScreen()).toBe(false)
    commit(true)
    await vi.waitFor(() => expect(win.isSimpleFullScreen()).toBe(true))
    commit(false)
    contents.emit('leave-html-full-screen')
    expect(win.isSimpleFullScreen()).toBe(false)
  }
})

it('ignores a late fullscreen commit after exit', async () => {
  const { win, contents, commit } = fixture()
  contents.emit('enter-html-full-screen')
  contents.emit('leave-html-full-screen')
  commit(true)
  await Promise.resolve()
  await Promise.resolve()
  expect(win.setSimpleFullScreen).not.toHaveBeenCalled()
})

it('preserves a window that was already fullscreen before the diagram', async () => {
  const { win, contents, commit } = fixture()
  win.setSimpleFullScreen(true)
  win.setSimpleFullScreen.mockClear()
  commit(true)
  contents.emit('enter-html-full-screen')
  await Promise.resolve()
  await Promise.resolve()
  commit(false)
  contents.emit('leave-html-full-screen')
  expect(win.isSimpleFullScreen()).toBe(true)
  expect(win.setSimpleFullScreen).not.toHaveBeenCalled()
})
