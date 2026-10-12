import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ dialog: {}, WebContentsView: class {}, ipcMain: {} }))
import { registerIntelligenceIpc } from './register-intelligence'
import { IPC_INVOKE } from '@shared/ipc/channels'
import type { IpcHandleRegistrar } from './trusted-ipc'
import type { ProjectIntelligenceService } from '../intelligence/service'
import type { ArchitectureViewer } from '../intelligence/viewer'

it('validates every architecture IPC boundary before services or viewer receive data', async () => {
  const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
  const ipc = {
    handle: (channel: string, handler: unknown) =>
      handlers.set(channel, handler as (_event: unknown, input: unknown) => Promise<unknown>)
  } as IpcHandleRegistrar
  const analyze = vi.fn(async () => ({ phase: 'scanning', files: 0 }))
  const status = vi.fn(async () => ({ phase: 'idle', files: 0 }))
  const source = vi.fn()
  const show = vi.fn()
  registerIntelligenceIpc(
    ipc,
    (fn) => fn(),
    { analyze, status, source } as unknown as ProjectIntelligenceService,
    { show } as unknown as ArchitectureViewer
  )
  expect(handlers.size).toBe(11)
  await expect(
    handlers.get(IPC_INVOKE.intelligenceMap)!(
      {},
      {
        root: '/allowed',
        snapshotId: '00000000-0000-4000-8000-000000000000',
        moduleId: '../outside'
      }
    )
  ).rejects.toThrow('Invalid')
  await handlers.get(IPC_INVOKE.intelligenceAnalyze)!({}, { root: '/allowed' })
  expect(analyze).toHaveBeenCalledWith({ root: '/allowed', ai: false, locale: 'en', excludes: [] })
  await expect(
    handlers.get(IPC_INVOKE.intelligenceStatus)!({}, { root: '/allowed', shell: 'bad' })
  ).rejects.toThrow('Invalid')
  await expect(
    handlers.get(IPC_INVOKE.intelligenceSource)!(
      {},
      {
        root: '/allowed',
        snapshotId: '00000000-0000-4000-8000-000000000000',
        moduleId: 'node',
        path: '../outside'
      }
    )
  ).rejects.toThrow('Invalid')
  await expect(
    handlers.get(IPC_INVOKE.intelligenceViewer)!(
      {},
      { url: 'file:///private', bounds: { x: 0, y: 0, width: 10, height: 10 }, theme: 'dark' }
    )
  ).rejects.toThrow('Invalid')
  expect(status).not.toHaveBeenCalled()
  expect(source).not.toHaveBeenCalled()
  expect(show).not.toHaveBeenCalled()
  await expect(
    handlers.get(IPC_INVOKE.intelligenceViewer)!(
      {},
      {
        url: 'pi-architecture://viewer/00000000-0000-4000-8000-000000000000',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        theme: 'light',
        controls: { range: '1', fullscreen: true, shell: 'bad' }
      }
    )
  ).rejects.toThrow('Invalid')
  expect(show).not.toHaveBeenCalled()
})
