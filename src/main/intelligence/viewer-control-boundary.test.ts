import { expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { ProjectIntelligenceService } from './service'
import { IPC_EVENT } from '@shared/ipc/channels'

const handlers = vi.hoisted(
  () => new Map<string, (event: { sender: unknown }, input: unknown) => void>()
)
vi.mock('electron', () => ({
  WebContentsView: class {},
  ipcMain: {
    on: (name: string, handler: (event: { sender: unknown }, input: unknown) => void) =>
      handlers.set(name, handler)
  }
}))
import { ArchitectureViewer } from './viewer'

it('accepts only fixed presentation actions from the current visible diagram', async () => {
  const send = vi.fn()
  const executeJavaScript = vi.fn(async () => undefined)
  const contents = {}
  const owner = {
    isDestroyed: () => false,
    webContents: { send, executeJavaScript }
  } as unknown as BrowserWindow
  const viewer = new ArchitectureViewer({} as ProjectIntelligenceService, '/virtual', () => owner)
  const url = 'pi-architecture://viewer/00000000-0000-4000-8000-000000000000'
  Object.assign(viewer, { visible: true, view: { webContents: contents }, owner, url })
  const command = handlers.get('architecture:control')!
  command({ sender: {} }, 'fullscreen')
  command({ sender: contents }, 'shell')
  command({ sender: contents }, { action: 'fullscreen', script: 'bad' })
  expect(executeJavaScript).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
  command({ sender: contents }, 'next')
  expect(send).toHaveBeenCalledExactlyOnceWith(IPC_EVENT.architectureControl, {
    url,
    action: 'next'
  })
  command({ sender: contents }, 'fullscreen')
  expect(executeJavaScript).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining('panel.requestFullscreen()'),
    true
  )
  Object.assign(viewer, { visible: false })
  command({ sender: contents }, 'fullscreen')
  command({ sender: contents }, 'previous')
  expect(executeJavaScript).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledTimes(1)
})
