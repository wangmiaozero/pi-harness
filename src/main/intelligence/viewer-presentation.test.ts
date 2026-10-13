import { expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { ProjectIntelligenceService } from './service'
vi.mock('electron', () => ({ WebContentsView: class {}, ipcMain: { on: vi.fn() } }))
import { ArchitectureViewer } from './viewer'

it('avoids repeated presentation work while still checking authorization and applying selections or changes', async () => {
  const authorize = vi.fn(async () => '<html></html>' as string | null)
  const executeJavaScript = vi.fn(async () => undefined)
  const view = {
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    webContents: {
      isDestroyed: () => false,
      executeJavaScript,
      loadURL: vi.fn(async () => undefined),
      close: vi.fn()
    }
  }
  const owner = {
    isDestroyed: () => false,
    getContentSize: () => [1200, 780],
    contentView: { removeChildView: vi.fn() },
    removeListener: vi.fn(),
    webContents: {
      isDestroyed: () => false,
      getURL: () => 'file:///app/index.html',
      send: vi.fn(),
      removeListener: vi.fn()
    }
  } as unknown as BrowserWindow
  const viewer = new ArchitectureViewer(
    { viewer: authorize } as unknown as ProjectIntelligenceService,
    '/resources',
    () => owner
  )
  Object.assign(viewer, { view, owner })
  const input = {
    url: 'pi-architecture://viewer/00000000-0000-4000-8000-000000000000',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    theme: 'dark'
  }
  for (let index = 0; index < 20; index++) await viewer.show(input)
  expect(authorize).toHaveBeenCalledTimes(20)
  expect(executeJavaScript).toHaveBeenCalledTimes(1)
  await viewer.show({ ...input, bounds: { ...input.bounds, width: 600 } })
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 600, height: 600 })
  expect(executeJavaScript).toHaveBeenCalledTimes(1)
  await viewer.show({ ...input, theme: 'light' })
  expect(executeJavaScript).toHaveBeenCalledTimes(2)
  for (let index = 0; index < 2; index++)
    await viewer.show({ ...input, selectedId: 'n-1234567890abcdef' })
  expect(executeJavaScript).toHaveBeenCalledTimes(4)
  authorize.mockResolvedValueOnce(null)
  await expect(viewer.show(input)).rejects.toThrow('authorization expired')
  viewer.close()
})
