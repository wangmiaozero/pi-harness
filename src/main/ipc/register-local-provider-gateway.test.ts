import { expect, it, vi } from 'vitest'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { registerLocalProviderGateway } from './register-local-provider-gateway'
import type { IpcHandleRegistrar } from './trusted-ipc'

it('validates gateway control requests and copies the key in Main', async () => {
  const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()
  const ipc = {
    handle: (channel: string, handler: never) => handlers.set(channel, handler)
  } as IpcHandleRegistrar
  const state = vi.fn(() => ({ running: false }))
  const start = vi.fn(async () => ({
    running: true as const,
    baseUrl: 'http://127.0.0.1:12345/v1'
  }))
  const stop = vi.fn(async () => {})
  const copy = vi.fn()
  const copyKey = vi.fn((copyText: (value: string) => void) => copyText('fixture'))
  registerLocalProviderGateway(ipc, (run) => run(), { state, start, stop, copyKey }, copy)
  const invoke = (channel: string, input?: unknown) => handlers.get(channel)!(null, input)
  await expect(
    invoke(IPC_INVOKE.providerGatewayStart, { port: 0, host: '0.0.0.0' })
  ).rejects.toThrow('port')
  await expect(invoke(IPC_INVOKE.providerGatewayStart, { port: -1 })).rejects.toThrow('port')
  expect(start).not.toHaveBeenCalled()
  await expect(invoke(IPC_INVOKE.providerGatewayState)).resolves.toEqual({ running: false })
  await expect(invoke(IPC_INVOKE.providerGatewayStart, { port: 0 })).resolves.toEqual({
    running: true,
    baseUrl: 'http://127.0.0.1:12345/v1'
  })
  await expect(invoke(IPC_INVOKE.providerGatewayCopyKey, 'leak')).rejects.toThrow('key request')
  await invoke(IPC_INVOKE.providerGatewayCopyKey)
  expect(copy).toHaveBeenCalledExactlyOnceWith('fixture')
  await expect(invoke(IPC_INVOKE.providerGatewayStop, true)).rejects.toThrow('stop request')
  await invoke(IPC_INVOKE.providerGatewayStop)
  expect(stop).toHaveBeenCalledOnce()
})
