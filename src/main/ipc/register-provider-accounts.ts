import { z } from 'zod'
import { BrowserWindow, dialog } from 'electron'
import { IPC_EVENT, IPC_INVOKE } from '@shared/ipc/channels'
import { chatGptConnectProgressSchema } from '@shared/providers/connect-progress'
import { chatGptGatewaySettingsSchema } from '@shared/providers/advanced-settings'
import { providerKeySchema } from '@shared/schemas/domain'
import {
  chatGptAccountIdSchema,
  chatGptFallbackSchema,
  chatGptExportAccountSchema,
  chatGptImportAccountSchema,
  chatGptLabelSchema,
  chatGptResetPolicySchema,
  chatGptModelEnabledSchema,
  chatGptModelSelectionSchema,
  chatGptRoutingModeSchema,
  chatGptVerifySchema,
  localAccountsInputSchema,
  usageRangeSchema
} from '@shared/schemas/ipc'
import type { HarnessRuntime } from '../harness/harness-runtime'
import type { ChatGptAccounts } from '../services/chatgpt-accounts'
import type { LocalAccountDiscovery } from '../services/local-account-discovery'
import type { ProviderQuota } from '../services/provider-quota'
import type { OpenRouterAuthorization } from '../services/openrouter-authorization'
import { ValidationError } from '../services/errors'
import type { IpcHandleRegistrar } from './trusted-ipc'

type Wrap = <T>(fn: () => Promise<T>) => Promise<unknown>

export function registerProviderAccounts(
  ipc: IpcHandleRegistrar,
  wrap: Wrap,
  chatGpt: ChatGptAccounts,
  local: LocalAccountDiscovery,
  quota: ProviderQuota,
  harness: HarnessRuntime,
  openAuthorization: (url: string) => Promise<void>,
  openRouter?: Pick<OpenRouterAuthorization, 'connect' | 'cancel'>
): void {
  const route = <T, R>(channel: string, schema: z.ZodType<T>, run: (input: T) => R) =>
    ipc.handle(channel, (_event, input: unknown) =>
      wrap(async () => {
        const result = schema.safeParse(input)
        if (!result.success) throw new ValidationError('Invalid provider account request')
        return run(result.data)
      })
    )
  route(IPC_INVOKE.localAccounts, localAccountsInputSchema, ({ refresh }) => local.list(refresh))
  route(IPC_INVOKE.chatGptAccounts, z.undefined(), () => chatGpt.list())
  ipc.handle(IPC_INVOKE.chatGptConnect, (event, input: unknown) =>
    wrap(async () => {
      if (!z.undefined().safeParse(input).success)
        throw new ValidationError('Invalid provider account request')
      return chatGpt.connect(openAuthorization, () => {
        if (event.sender.isDestroyed()) return
        event.sender.send(
          IPC_EVENT.chatGptConnectProgress,
          chatGptConnectProgressSchema.parse({ phase: 'exchange' })
        )
      })
    })
  )
  route(IPC_INVOKE.chatGptCancel, z.undefined(), () => chatGpt.cancelLogin())
  if (openRouter) {
    route(IPC_INVOKE.openRouterConnect, z.undefined(), () => openRouter.connect(openAuthorization))
    route(IPC_INVOKE.openRouterCancel, z.undefined(), () => openRouter.cancel())
  }
  route(IPC_INVOKE.chatGptVerify, chatGptVerifySchema, ({ id, modelId }) =>
    chatGpt.verify(id, modelId)
  )
  route(IPC_INVOKE.chatGptCatalogRefresh, chatGptAccountIdSchema, (id) =>
    chatGpt.refreshCatalog(id)
  )
  route(IPC_INVOKE.chatGptModelEnabled, chatGptModelEnabledSchema, ({ id, modelId, enabled }) =>
    chatGpt.setModelEnabled(id, modelId, enabled)
  )
  route(IPC_INVOKE.chatGptModelSelection, chatGptModelSelectionSchema, (input) =>
    chatGpt.setModelSelection(input)
  )
  ipc.handle(IPC_INVOKE.chatGptExportAccount, (event, input) =>
    wrap(async () => {
      const result = chatGptExportAccountSchema.safeParse(input)
      if (!result.success) throw new ValidationError('Invalid provider account request')
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options = {
        defaultPath: 'chatgpt-account.pihaccount',
        filters: [{ name: 'Pi-Harness account backup', extensions: ['pihaccount'] }]
      }
      const chosen = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options)
      if (chosen.canceled || !chosen.filePath) return false
      await chatGpt.exportAccount(result.data.id, chosen.filePath, result.data.password)
      return true
    })
  )
  ipc.handle(IPC_INVOKE.chatGptImportAccount, (event, input) =>
    wrap(async () => {
      const result = chatGptImportAccountSchema.safeParse(input)
      if (!result.success) throw new ValidationError('Invalid provider account request')
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options = {
        properties: ['openFile' as const],
        filters: [{ name: 'Pi-Harness account backup', extensions: ['pihaccount'] }]
      }
      const chosen = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      if (chosen.canceled || !chosen.filePaths[0]) return false
      await chatGpt.importAccount(chosen.filePaths[0], result.data.password)
      return true
    })
  )
  route(IPC_INVOKE.chatGptDefaultModel, chatGptVerifySchema.nullable(), (input) =>
    chatGpt.setDefaultModel(input)
  )
  route(IPC_INVOKE.chatGptFallback, chatGptFallbackSchema, ({ id, enabled }) =>
    chatGpt.setFallbackAccount(id, enabled)
  )
  route(IPC_INVOKE.chatGptRoutingMode, chatGptRoutingModeSchema, (mode) =>
    chatGpt.setRoutingMode(mode)
  )
  route(IPC_INVOKE.chatGptLabel, chatGptLabelSchema, ({ id, label }) => chatGpt.setLabel(id, label))
  route(IPC_INVOKE.chatGptAllowance, chatGptAccountIdSchema, (id) => chatGpt.allowance(id))
  route(
    IPC_INVOKE.chatGptResetPolicy,
    chatGptResetPolicySchema,
    ({ id, week, expiring, leadMinutes }) =>
      chatGpt.setResetPolicy(id, { week, expiring, leadMinutes })
  )
  route(IPC_INVOKE.chatGptUseReset, chatGptAccountIdSchema, (id) => chatGpt.useReset(id))
  route(IPC_INVOKE.chatGptDisconnect, chatGptAccountIdSchema, (id) => chatGpt.disconnect(id))
  route(IPC_INVOKE.chatGptGatewaySettings, z.undefined(), () => chatGpt.gatewaySettings())
  route(IPC_INVOKE.chatGptSetGatewaySettings, chatGptGatewaySettingsSchema, (settings) =>
    chatGpt.setGatewaySettings(settings)
  )
  route(IPC_INVOKE.providerQuota, providerKeySchema, (key) => quota.read(key))
  route(IPC_INVOKE.providerUsage, usageRangeSchema, (range) => harness.usageReport(range))
  route(IPC_INVOKE.providerUsageClear, z.undefined(), () => harness.clearUsageHistory())
}
