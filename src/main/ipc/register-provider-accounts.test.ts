import { expect, it, vi } from 'vitest'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { registerProviderAccounts } from './register-provider-accounts'
import type { IpcHandleRegistrar } from './trusted-ipc'
import type { HarnessRuntime } from '../harness/harness-runtime'
import type { ChatGptAccounts } from '../services/chatgpt-accounts'
import type { LocalAccountDiscovery } from '../services/local-account-discovery'
import type { ProviderQuota } from '../services/provider-quota'

it('validates account, model, refresh and date range payloads before service calls', async () => {
  const handlers = new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>()
  const ipc = {
    handle: (channel: string, run: never) => handlers.set(channel, run)
  } as IpcHandleRegistrar
  const verify = vi.fn(async (_id: string, _modelId: string) => undefined)
  const refreshCatalog = vi.fn(async (_id: string) => undefined)
  const setModelEnabled = vi.fn(
    async (_id: string, _modelId: string, _enabled: boolean) => undefined
  )
  const setDefaultModel = vi.fn(async (_model: { id: string; modelId: string } | null) => undefined)
  const setFallbackAccount = vi.fn(async (_id: string, _enabled: boolean) => undefined)
  const routeDefault = vi.fn(async () => null)
  const list = vi.fn(async (_refresh: boolean) => [])
  const read = vi.fn(async (_key: string) => null)
  const usageReport = vi.fn(
    async (_range: { start: number; end: number; timeZone: string }) => ({})
  )
  const clearUsageHistory = vi.fn(async () => undefined)
  registerProviderAccounts(
    ipc,
    (run) => run(),
    {
      verify,
      refreshCatalog,
      setModelEnabled,
      setDefaultModel,
      setFallbackAccount,
      routeDefault
    } as unknown as ChatGptAccounts,
    { list } as unknown as LocalAccountDiscovery,
    { read } as unknown as ProviderQuota,
    { usageReport, clearUsageHistory } as unknown as HarnessRuntime,
    async () => {}
  )
  const id = 'chatgpt-account-493957de-923a-4681-b5b6-d8de350c293a'
  const dispatch = (channel: string, input?: unknown) => handlers.get(channel)!(null, input)
  await dispatch(IPC_INVOKE.chatGptVerify, { id, modelId: 'gpt-5' })
  expect(verify).toHaveBeenCalledWith(id, 'gpt-5')
  await dispatch(IPC_INVOKE.chatGptCatalogRefresh, id)
  expect(refreshCatalog).toHaveBeenCalledExactlyOnceWith(id)
  await expect(
    dispatch(IPC_INVOKE.chatGptCatalogRefresh, { id, endpoint: 'http://localhost' })
  ).rejects.toThrow('Invalid provider account request')
  await dispatch(IPC_INVOKE.chatGptModelEnabled, { id, modelId: 'gpt-5', enabled: false })
  expect(setModelEnabled).toHaveBeenCalledExactlyOnceWith(id, 'gpt-5', false)
  await expect(
    dispatch(IPC_INVOKE.chatGptModelEnabled, { id, modelId: 'gpt-5', enabled: 'false' })
  ).rejects.toThrow('Invalid provider account request')
  await dispatch(IPC_INVOKE.chatGptDefaultModel, null)
  expect(setDefaultModel).toHaveBeenCalledExactlyOnceWith(null)
  await expect(
    dispatch(IPC_INVOKE.chatGptDefaultModel, { id, modelId: '../secret' })
  ).rejects.toThrow('Invalid provider account request')
  await dispatch(IPC_INVOKE.chatGptFallback, { id, enabled: true })
  expect(setFallbackAccount).toHaveBeenCalledExactlyOnceWith(id, true)
  await expect(dispatch(IPC_INVOKE.chatGptFallback, { id, enabled: 'true' })).rejects.toThrow(
    'Invalid provider account request'
  )
  await expect(dispatch(IPC_INVOKE.chatGptRouteDefault)).resolves.toBeNull()
  expect(routeDefault).toHaveBeenCalledTimes(1)
  await expect(dispatch(IPC_INVOKE.chatGptRouteDefault, { id })).rejects.toThrow(
    'Invalid provider account request'
  )
  await expect(
    dispatch(IPC_INVOKE.chatGptVerify, { id, modelId: 'x', endpoint: 'http://localhost' })
  ).rejects.toThrow('Invalid provider account request')
  await expect(dispatch(IPC_INVOKE.chatGptDisconnect, '../auth.json')).rejects.toThrow(
    'Invalid provider account request'
  )
  await expect(dispatch(IPC_INVOKE.localAccounts, { refresh: 'true' })).rejects.toThrow(
    'Invalid provider account request'
  )
  await dispatch(IPC_INVOKE.localAccounts, { refresh: true })
  expect(list).toHaveBeenCalledExactlyOnceWith(true)
  await expect(dispatch(IPC_INVOKE.providerQuota, '../key')).rejects.toThrow(
    'Invalid provider account request'
  )
  expect(read).not.toHaveBeenCalled()
  await expect(
    dispatch(IPC_INVOKE.providerUsage, { start: 2, end: 1, timeZone: 'UTC' })
  ).rejects.toThrow('Invalid provider account request')
  await expect(
    dispatch(IPC_INVOKE.providerUsage, { start: 1, end: 2, timeZone: 'not/a/zone' })
  ).rejects.toThrow('Invalid provider account request')
  await dispatch(IPC_INVOKE.providerUsage, { start: 1, end: 2, timeZone: 'UTC' })
  expect(usageReport).toHaveBeenCalledExactlyOnceWith({ start: 1, end: 2, timeZone: 'UTC' })
  await expect(dispatch(IPC_INVOKE.providerUsageClear, { all: true })).rejects.toThrow(
    'Invalid provider account request'
  )
  await dispatch(IPC_INVOKE.providerUsageClear)
  expect(clearUsageHistory).toHaveBeenCalledTimes(1)
})
