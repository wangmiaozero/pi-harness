import { describe, expect, it, vi } from 'vitest'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { registerWorkspaceIpc, type WorkspaceServices } from './register-workspace'
import type { IpcHandleRegistrar } from './trusted-ipc'

vi.mock('electron', () => ({ BrowserWindow: {}, Menu: {}, dialog: {} }))

describe('managed workspace identity IPC', () => {
  it('returns only Main-owned identities and rejects unexpected renderer input', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const getDefaultWorkspaceRoots = vi.fn(async () => ['/managed/workspaces/default'])
    registerWorkspaceIpc(
      {
        handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
          handlers.set(channel, handler)
      } as unknown as IpcHandleRegistrar,
      async (fn) => ({ ok: true, data: await fn() }),
      { workspaceState: { getDefaultWorkspaceRoots } } as unknown as WorkspaceServices
    )
    const getRoots = handlers.get(IPC_INVOKE.workspaceGetDefaultRoots)!
    await expect(getRoots({})).resolves.toEqual({
      ok: true,
      data: ['/managed/workspaces/default']
    })
    await expect(getRoots({}, { roots: ['/arbitrary/default'] })).rejects.toThrow(
      'Invalid workspace identity request'
    )
    expect(getDefaultWorkspaceRoots).toHaveBeenCalledOnce()
  })
})
