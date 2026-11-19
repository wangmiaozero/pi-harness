import { expect, it, vi } from 'vitest'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { registerModelPreferences } from './register-model-preferences'
import type { ModelService } from '../services/model-service'
import type { ProviderService } from '../services/provider-service'
import type { IpcHandleRegistrar } from './trusted-ipc'

it('validates model visibility and fast mode before saving them', async () => {
  const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => Promise<unknown>>()
  const ipc = {
    handle: (channel: string, handler: never) => handlers.set(channel, handler)
  } as IpcHandleRegistrar
  const setVisibility = vi.fn<ModelService['setVisibility']>(async () => [])
  const setFastMode = vi.fn<ProviderService['setFastMode']>(async (enabled) => enabled)
  const fastMode = vi.fn<ProviderService['fastMode']>(async () => true)
  registerModelPreferences(ipc, (run) => run(), { setVisibility }, { fastMode, setFastMode })
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(null, ...args)

  for (const entries of [
    [],
    [{ id: 'openai', enabled: true }],
    [{ id: 'openai::gpt-6.2-sol', enabled: 'yes' }],
    [{ id: 'openai::gpt-6.2-sol', enabled: true, extra: 1 }]
  ])
    await expect(call(IPC_INVOKE.modelSetVisibility, entries)).rejects.toThrow(
      'Invalid model visibility'
    )
  await expect(call(IPC_INVOKE.modelSetFastMode, 'on')).rejects.toThrow('Invalid fast mode')
  expect(setVisibility).not.toHaveBeenCalled()
  expect(setFastMode).not.toHaveBeenCalled()

  const entries = [
    { id: 'openai::gpt-6.2-sol', enabled: true },
    { id: 'openai::gpt-4.1', enabled: false }
  ]
  await call(IPC_INVOKE.modelSetVisibility, entries)
  expect(setVisibility).toHaveBeenCalledExactlyOnceWith(entries)
  await expect(call(IPC_INVOKE.modelSetFastMode, true)).resolves.toBe(true)
  await expect(call(IPC_INVOKE.modelFastMode)).resolves.toBe(true)
})
