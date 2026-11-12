import { z } from 'zod'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { providerKeySchema } from '@shared/schemas/domain'
import {
  chatGptAccountIdSchema,
  chatGptFallbackSchema,
  chatGptModelEnabledSchema,
  chatGptVerifySchema,
  localAccountsInputSchema,
  usageRangeSchema
} from '@shared/schemas/ipc'
import type { HarnessRuntime } from '../harness/harness-runtime'
import type { ChatGptAccounts } from '../services/chatgpt-accounts'
import type { LocalAccountDiscovery } from '../services/local-account-discovery'
import type { ProviderQuota } from '../services/provider-quota'
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
  openAuthorization: (url: string) => Promise<void>
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
  route(IPC_INVOKE.chatGptConnect, z.undefined(), () => chatGpt.connect(openAuthorization))
  route(IPC_INVOKE.chatGptCancel, z.undefined(), () => chatGpt.cancelLogin())
  route(IPC_INVOKE.chatGptVerify, chatGptVerifySchema, ({ id, modelId }) =>
    chatGpt.verify(id, modelId)
  )
  route(IPC_INVOKE.chatGptCatalogRefresh, chatGptAccountIdSchema, (id) =>
    chatGpt.refreshCatalog(id)
  )
  route(IPC_INVOKE.chatGptModelEnabled, chatGptModelEnabledSchema, ({ id, modelId, enabled }) =>
    chatGpt.setModelEnabled(id, modelId, enabled)
  )
  route(IPC_INVOKE.chatGptDefaultModel, chatGptVerifySchema.nullable(), (input) =>
    chatGpt.setDefaultModel(input)
  )
  route(IPC_INVOKE.chatGptFallback, chatGptFallbackSchema, ({ id, enabled }) =>
    chatGpt.setFallbackAccount(id, enabled)
  )
  route(IPC_INVOKE.chatGptRouteDefault, z.undefined(), () => chatGpt.routeDefault())
  route(IPC_INVOKE.chatGptDisconnect, chatGptAccountIdSchema, (id) => chatGpt.disconnect(id))
  route(IPC_INVOKE.providerQuota, providerKeySchema, (key) => quota.read(key))
  route(IPC_INVOKE.providerUsage, usageRangeSchema, (range) => harness.usageReport(range))
  route(IPC_INVOKE.providerUsageClear, z.undefined(), () => harness.clearUsageHistory())
}
