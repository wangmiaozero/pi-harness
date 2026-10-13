import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { ProjectIntelligenceService } from './service'

const createView = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  WebContentsView: class {
    constructor() {
      return createView()
    }
  },
  ipcMain: { on: vi.fn() }
}))
import { ArchitectureViewer } from './viewer'

it('retires the native diagram on host reload and cancels pending display requests', async () => {
  const session = {
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    on: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
    protocol: { handle: vi.fn() }
  }
  const makeView = () => ({
    setVisible: vi.fn(),
    setBounds: vi.fn(),
    webContents: Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      loadURL: vi.fn(async () => undefined),
      executeJavaScript: vi.fn(async () => undefined),
      setWindowOpenHandler: vi.fn(),
      close: vi.fn(),
      session
    })
  })
  const views: ReturnType<typeof makeView>[] = []
  createView.mockImplementation(() => {
    const view = makeView()
    views.push(view)
    return view
  })
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getURL: () => 'file:///app/index.html#/workspace'
  })
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getContentSize: () => [1200, 780],
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: contents
  })
  const authorize = vi.fn(async () => '<html></html>' as string | null)
  const viewer = new ArchitectureViewer(
    { viewer: authorize } as unknown as ProjectIntelligenceService,
    '/resources',
    () => owner as unknown as BrowserWindow
  )
  const input = {
    url: 'pi-architecture://viewer/00000000-0000-4000-8000-000000000000',
    bounds: { x: 100, y: 100, width: 800, height: 600 },
    theme: 'dark'
  }
  await viewer.show(input)
  const first = views[0]
  expect(first.setVisible).toHaveBeenNthCalledWith(1, false)
  expect(first.setVisible).toHaveBeenLastCalledWith(true)
  contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  expect(first.webContents.close).not.toHaveBeenCalled()

  let resolveAuthorization!: (html: string) => void
  authorize.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveAuthorization = resolve
    })
  )
  const pending = viewer.show(input)
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  expect(owner.contentView.removeChildView).toHaveBeenCalledWith(first)
  expect(first.webContents.close).toHaveBeenCalledOnce()
  expect(contents.listenerCount('did-start-navigation')).toBe(0)
  expect(owner.listenerCount('closed')).toBe(0)
  resolveAuthorization('<html></html>')
  await pending
  expect(views).toHaveLength(1)

  await viewer.show(input)
  expect(views).toHaveLength(2)
  expect(views[1].setVisible).toHaveBeenLastCalledWith(true)
  expect(contents.listenerCount('did-start-navigation')).toBe(1)
  expect(owner.listenerCount('closed')).toBe(1)
  viewer.close()
  expect(contents.listenerCount('did-start-navigation')).toBe(0)
  expect(owner.listenerCount('closed')).toBe(0)
})
