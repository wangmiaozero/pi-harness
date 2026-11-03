import { expect, it, vi } from 'vitest'
import { registerHarnessIpc } from './register-harness'
import type { HarnessRuntime } from '../harness/harness-runtime'
import type { IpcHandleRegistrar } from './trusted-ipc'
import { IPC_INVOKE } from '@shared/ipc/channels'

it('accepts only session/run identifiers for file undo IPC', async () => {
  const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
  const ipc = {
    handle: (channel: string, handler: unknown) =>
      handlers.set(channel, handler as (_event: unknown, input: unknown) => Promise<unknown>)
  } as IpcHandleRegistrar
  const status = { available: true, undone: false, fileCount: 1, remainingCount: 1 }
  const harness = {
    fileUndoStatus: vi.fn(async () => status),
    undoRunFiles: vi.fn(async () => status)
  }
  registerHarnessIpc(
    ipc,
    async (fn) => ({ ok: true, data: await fn() }),
    harness as unknown as HarnessRuntime
  )
  for (const channel of [IPC_INVOKE.harnessFileUndoStatus, IPC_INVOKE.harnessUndoRunFiles]) {
    const handler = handlers.get(channel)!
    for (const invalid of [
      {},
      { sessionId: 's', runId: '' },
      { sessionId: 's', runId: 'r', path: '/outside' }
    ]) {
      await expect(handler({}, invalid)).rejects.toThrow('Invalid')
    }
    await expect(handler({}, { sessionId: 's', runId: 'r' })).resolves.toEqual({
      ok: true,
      data: status
    })
  }
  expect(harness.undoRunFiles).toHaveBeenCalledExactlyOnceWith('s', 'r')
  expect(harness.fileUndoStatus).toHaveBeenCalledExactlyOnceWith('s', 'r')
})
