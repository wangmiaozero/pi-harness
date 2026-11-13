import { expect, it, vi } from 'vitest'
import { IPC_EVENT, IPC_INVOKE } from '@shared/ipc/channels'
import { readChatGptConnectProgress } from '@shared/providers/connect-progress'
import { registerProviderAccounts } from './register-provider-accounts'
import type { IpcHandleRegistrar } from './trusted-ipc'
import type { HarnessRuntime } from '../harness/harness-runtime'
import type { ChatGptAccounts } from '../services/chatgpt-accounts'
import type { LocalAccountDiscovery } from '../services/local-account-discovery'
import type { ProviderQuota } from '../services/provider-quota'
import type { ChatGptRoutingMode } from '@shared/providers/account-management'

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
  const setRoutingMode = vi.fn(async (_mode: ChatGptRoutingMode) => undefined)
  const setLabel = vi.fn(async (_id: string, _label: string) => undefined)
  const list = vi.fn(async (_refresh: boolean) => [])
  const read = vi.fn(async (_key: string) => null)
  const usageReport = vi.fn(
    async (_range: { start: number; end: number; timeZone: string }) => ({})
  )
  const clearUsageHistory = vi.fn(async () => undefined)
  const openRouterConnect = vi.fn(async (_open: (url: string) => Promise<void>) => 'openrouter-id')
  const openRouterCancel = vi.fn(() => {})
  const openAuthorization = async () => {}
  registerProviderAccounts(
    ipc,
    (run) => run(),
    {
      verify,
      refreshCatalog,
      setModelEnabled,
      setDefaultModel,
      setFallbackAccount,
      setRoutingMode,
      setLabel
    } as unknown as ChatGptAccounts,
    { list } as unknown as LocalAccountDiscovery,
    { read } as unknown as ProviderQuota,
    { usageReport, clearUsageHistory } as unknown as HarnessRuntime,
    openAuthorization,
    { connect: openRouterConnect, cancel: openRouterCancel }
  )
  const id = 'chatgpt-account-493957de-923a-4681-b5b6-d8de350c293a'
  const dispatch = (channel: string, input?: unknown) => handlers.get(channel)!(null, input)
  await expect(
    dispatch(IPC_INVOKE.openRouterConnect, { endpoint: 'http://localhost' })
  ).rejects.toThrow('Invalid provider account request')
  expect(openRouterConnect).not.toHaveBeenCalled()
  await expect(dispatch(IPC_INVOKE.openRouterConnect)).resolves.toBe('openrouter-id')
  expect(openRouterConnect).toHaveBeenCalledExactlyOnceWith(openAuthorization)
  await expect(dispatch(IPC_INVOKE.openRouterCancel, null)).rejects.toThrow(
    'Invalid provider account request'
  )
  expect(openRouterCancel).not.toHaveBeenCalled()
  await dispatch(IPC_INVOKE.openRouterCancel)
  expect(openRouterCancel).toHaveBeenCalledOnce()
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
  await dispatch(IPC_INVOKE.chatGptRoutingMode, 'roundRobin')
  expect(setRoutingMode).toHaveBeenCalledExactlyOnceWith('roundRobin')
  await expect(dispatch(IPC_INVOKE.chatGptRoutingMode, 'cheapest')).rejects.toThrow(
    'Invalid provider account request'
  )
  await dispatch(IPC_INVOKE.chatGptLabel, { id, label: '  Work  ' })
  expect(setLabel).toHaveBeenCalledExactlyOnceWith(id, 'Work')
  await expect(dispatch(IPC_INVOKE.chatGptLabel, { id, label: 'Work\nKey' })).rejects.toThrow(
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

it('publishes the exchange event for a real connect and drops anything else', async () => {
  const handlers = new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>()
  const ipc = {
    handle: (channel: string, run: never) => handlers.set(channel, run)
  } as IpcHandleRegistrar
  const connect = vi.fn(async (_open: (url: string) => Promise<void>, onExchange?: () => void) => {
    onExchange?.()
  })
  registerProviderAccounts(
    ipc,
    (run) => run(),
    { connect } as unknown as ChatGptAccounts,
    { list: vi.fn() } as unknown as LocalAccountDiscovery,
    { read: vi.fn() } as unknown as ProviderQuota,
    { usageReport: vi.fn(), clearUsageHistory: vi.fn() } as unknown as HarnessRuntime,
    async () => {}
  )
  const send = vi.fn()
  const event = { sender: { isDestroyed: () => false, send } }
  await handlers.get(IPC_INVOKE.chatGptConnect)!(event, undefined)
  expect(send).toHaveBeenCalledExactlyOnceWith(IPC_EVENT.chatGptConnectProgress, {
    phase: 'exchange'
  })
  expect(readChatGptConnectProgress(send.mock.calls[0][1])).toEqual({ phase: 'exchange' })
  send.mockClear()
  const destroyed = { sender: { isDestroyed: () => true, send } }
  await handlers.get(IPC_INVOKE.chatGptConnect)!(destroyed, undefined)
  expect(send).not.toHaveBeenCalled()
  await expect(
    handlers.get(IPC_INVOKE.chatGptConnect)!(event, { url: 'http://localhost' })
  ).rejects.toThrow('Invalid provider account request')
  expect(connect).toHaveBeenCalledTimes(2)
  expect(readChatGptConnectProgress({ phase: 'exchange', token: 'secret' })).toBeNull()
  expect(readChatGptConnectProgress({ phase: 'done' })).toBeNull()
  expect(readChatGptConnectProgress(null)).toBeNull()
})
