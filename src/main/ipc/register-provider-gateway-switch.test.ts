import { expect, it, vi } from 'vitest'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { registerProviderGatewaySwitch } from './register-provider-gateway-switch'
import type { ProviderService } from '../services/provider-service'
import type { ProviderProfile } from '@shared/types/domain'
import type { IpcHandleRegistrar } from './trusted-ipc'

it('validates the provider key and gateway state before switching', async () => {
  const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => Promise<unknown>>()
  const ipc = {
    handle: (channel: string, handler: never) => handlers.set(channel, handler)
  } as IpcHandleRegistrar
  const setGateway = vi.fn<ProviderService['setGateway']>(
    async (key, enabled) => ({ key, gateway: enabled }) as ProviderProfile
  )
  registerProviderGatewaySwitch(ipc, (run) => run(), { setGateway })
  const run = (...args: unknown[]) => handlers.get(IPC_INVOKE.providerSetGateway)!(null, ...args)

  await expect(run('../escape', true)).rejects.toThrow('Invalid provider key')
  await expect(run('openai', 'true')).rejects.toThrow('Invalid gateway state')
  await expect(run('openai')).rejects.toThrow('Invalid gateway state')
  expect(setGateway).not.toHaveBeenCalled()

  await expect(run('openai', true)).resolves.toMatchObject({ key: 'openai', gateway: true })
  await expect(run('openai', false)).resolves.toMatchObject({ gateway: false })
  expect(setGateway.mock.calls).toEqual([
    ['openai', true],
    ['openai', false]
  ])
})
