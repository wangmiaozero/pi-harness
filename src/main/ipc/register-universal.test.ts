import { describe, expect, it, vi } from 'vitest'
import { registerUniversalIpc } from './register-universal'
import { IPC_INVOKE } from '@shared/ipc/channels'
import type { UniversalSessionService } from '../universal/service'
import type { UniversalHandoffService } from '../universal/handoff'
import type { FileAccessService } from '../files/file-access-service'
import type { IpcHandleRegistrar } from './trusted-ipc'
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {} }))

describe('typed history IPC validation', () => {
  function setup() {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const sources = vi.fn(async () => [])
    const read = vi.fn(async () => null)
    const map = vi.fn(async () => null)
    const preview = vi.fn(async () => null)
    const denied = vi.fn(async () => {
      throw new Error('PATH_DENIED')
    })
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
        handlers.set(channel, handler)
    } as unknown as IpcHandleRegistrar
    registerUniversalIpc(
      ipc,
      (fn) => fn(),
      { sources, read, map } as unknown as UniversalSessionService,
      { preview } as unknown as UniversalHandoffService,
      { assertAllowed: denied } as unknown as FileAccessService
    )
    return { handlers, sources, read, map, preview, denied }
  }
  it('accepts zero arguments and rejects unexpected arguments before scanning', async () => {
    const { handlers, sources } = setup()
    await handlers.get(IPC_INVOKE.universalSources)!({})
    expect(sources).toHaveBeenCalledOnce()
    await expect(
      handlers.get(IPC_INVOKE.universalSources)!({}, { arbitraryPath: '/etc' })
    ).rejects.toThrow('Invalid history request')
    expect(sources).toHaveBeenCalledOnce()
  })
  it('rejects paths, oversized pages and unknown fields without reading source data', async () => {
    const { handlers, read } = setup()
    for (const input of [
      { id: '../secrets' },
      { id: 'a'.repeat(64), limit: 1000 },
      { id: 'a'.repeat(64), path: '/etc' }
    ]) {
      await expect(handlers.get(IPC_INVOKE.universalRead)!({}, input)).rejects.toThrow(
        'Invalid history request'
      )
    }
    expect(read).not.toHaveBeenCalled()
  })
  it('requires existing Main authorization for a project mapping', async () => {
    const { handlers, map, denied } = setup()
    await expect(
      handlers.get(IPC_INVOKE.universalMap)!(
        {},
        { id: 'a'.repeat(64), workspacePath: '/unauthorized' }
      )
    ).rejects.toThrow('PATH_DENIED')
    expect(denied).toHaveBeenCalledWith('/unauthorized', { mustExist: true })
    expect(map).not.toHaveBeenCalled()
  })
  it('cannot create or run a handoff with an empty instruction or forged identifier', async () => {
    const { handlers, preview } = setup()
    await expect(
      handlers.get(IPC_INVOKE.universalPreview)!({}, { id: 'a'.repeat(64), instruction: '' })
    ).rejects.toThrow('Invalid history request')
    await expect(
      handlers.get(IPC_INVOKE.universalContinue)!({}, { id: '../arbitrary' })
    ).rejects.toThrow('Invalid history request')
    expect(preview).not.toHaveBeenCalled()
  })
})
