import { expect, it, vi } from 'vitest'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { registerProviderConnection } from './register-provider-connection'
import type { ProviderService } from '../services/provider-service'
import type { IpcHandleRegistrar } from './trusted-ipc'

it('validates requests and cancels only the matching pending test', async () => {
  const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()
  const ipc = {
    handle: (channel: string, handler: never) => handlers.set(channel, handler)
  } as IpcHandleRegistrar
  const testConnection = vi.fn<ProviderService['testConnection']>(async (_input, signal) => {
    if (signal)
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
    return {
      ok: !signal,
      status: signal ? 'cancelled' : 'success',
      httpStatus: signal ? null : 200,
      latencyMs: 0,
      message: 'fixture'
    }
  })
  registerProviderConnection(ipc, (run) => run(), { testConnection })
  const run = (input: unknown) => handlers.get(IPC_INVOKE.providerTestConnection)!(null, input)
  const cancel = (input: unknown) =>
    handlers.get(IPC_INVOKE.providerCancelConnectionTest)!(null, input)
  await expect(run({ providerKey: 'fixture', requestId: 'bad' })).rejects.toThrow(
    'Invalid test input'
  )
  await expect(cancel({ requestId: crypto.randomUUID() })).rejects.toThrow(
    'Invalid connection test ID'
  )
  expect(testConnection).not.toHaveBeenCalled()
  await expect(run({ providerKey: 'fixture' })).resolves.toMatchObject({ status: 'success' })
  const requestId = crypto.randomUUID()
  const request = run({ providerKey: 'fixture', requestId })
  await expect(run({ providerKey: 'fixture', requestId })).rejects.toThrow('already running')
  await cancel(crypto.randomUUID())
  expect(testConnection.mock.calls[1]?.[1]?.aborted).toBe(false)
  await cancel(requestId)
  await expect(request).resolves.toMatchObject({ status: 'cancelled' })
})
