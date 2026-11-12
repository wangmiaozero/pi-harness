import { describe, expect, it, vi } from 'vitest'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { registerWorkspaceIpc, type WorkspaceServices } from './register-workspace'
import type { IpcHandleRegistrar } from './trusted-ipc'

vi.mock('electron', () => ({ BrowserWindow: {}, Menu: {}, dialog: {} }))

describe('managed workspace identity IPC', () => {
  it('routes only a new chat and passes the physical provider to the agent runtime', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const input = { id: 'chatgpt-account-493957de-923a-4681-b5b6-d8de350c293a', modelId: 'gpt-5' }
    const start = vi.fn(async (_input: { cwd?: string; provider?: string; modelId?: string }) => ({
      sessionId: 'session',
      cwd: '/managed/default'
    }))
    const assertAllowed = vi.fn(async (_cwd: string) => {})
    const routeDefault = vi.fn(async (_input: { id: string; modelId: string }) => ({
      provider: 'allowed-backup',
      modelId: 'gpt-5'
    }))
    registerWorkspaceIpc(
      {
        handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
          handlers.set(channel, handler)
      } as unknown as IpcHandleRegistrar,
      async (fn) => ({ ok: true, data: await fn() }),
      { access: { assertAllowed }, agent: { start } } as unknown as WorkspaceServices,
      { routeDefault }
    )
    const dispatch = handlers.get(IPC_INVOKE.agentStart)!
    const request = { cwd: '/managed/default', chatGptDefault: input }
    await expect(dispatch(null, { ...request, sessionId: 'old-session' })).rejects.toThrow(
      'Invalid start'
    )
    await expect(dispatch(null, { ...request, provider: 'different-provider' })).rejects.toThrow(
      'Invalid start'
    )
    await expect(
      dispatch(null, { ...request, chatGptDefault: { ...input, endpoint: 'http://localhost' } })
    ).rejects.toThrow('Invalid start')
    expect(routeDefault).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    await dispatch(null, request)
    expect(routeDefault).toHaveBeenCalledExactlyOnceWith(input)
    expect(start).toHaveBeenCalledExactlyOnceWith({
      cwd: request.cwd,
      provider: 'allowed-backup',
      modelId: 'gpt-5'
    })
  })

  it('creates chats in the managed default workspace without accepting a renderer path', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const folders = [
      { id: 'managed-folder', resolvedPath: '/managed/default', role: 'main', readonly: false }
    ]
    const createEmpty = vi.fn(async () => ({ id: 'new-session' }))
    const bindSession = vi.fn()
    const ensureDefaultWorkspace = vi.fn(async () => ({ id: 'default', folders }))
    registerWorkspaceIpc(
      {
        handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
          handlers.set(channel, handler)
      } as unknown as IpcHandleRegistrar,
      async (fn) => ({ ok: true, data: await fn() }),
      {
        sessions: { createEmpty },
        workspaceState: { ensureDefaultWorkspace, bindSession }
      } as unknown as WorkspaceServices
    )
    const create = handlers.get(IPC_INVOKE.sessionCreate)!
    await expect(create({})).resolves.toEqual({ ok: true, data: { id: 'new-session' } })
    expect(createEmpty).toHaveBeenCalledWith('/managed/default')
    expect(bindSession).toHaveBeenCalledWith(
      'new-session',
      expect.objectContaining({
        workspaceId: 'default',
        mainFolderId: 'managed-folder',
        folders: [{ id: 'managed-folder', path: '/managed/default', role: 'main', readonly: false }]
      })
    )
    await expect(create({}, { cwd: '/untrusted/path' })).rejects.toThrow()
    expect(createEmpty).toHaveBeenCalledTimes(1)
  })
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
