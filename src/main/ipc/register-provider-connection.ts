import { IPC_INVOKE } from '@shared/ipc/channels'
import { testConnectionRequestIdSchema, testConnectionSchema } from '@shared/schemas/domain'
import { ValidationError } from '../services/errors'
import type { ProviderService } from '../services/provider-service'
import type { IpcHandleRegistrar } from './trusted-ipc'

export function registerProviderConnection(
  ipc: IpcHandleRegistrar,
  wrap: <T>(run: () => Promise<T>) => Promise<unknown>,
  providers: Pick<ProviderService, 'testConnection'>
) {
  const pending = new Map<string, AbortController>()
  ipc.handle(IPC_INVOKE.providerTestConnection, (_event, input: unknown) =>
    wrap(async () => {
      const parsed = testConnectionSchema.safeParse(input)
      if (!parsed.success) throw new ValidationError('Invalid test input')
      const { requestId, ...test } = parsed.data
      if (!requestId) return providers.testConnection(test)
      if (pending.has(requestId)) throw new ValidationError('Connection test already running')
      const controller = new AbortController()
      pending.set(requestId, controller)
      try {
        return await providers.testConnection(test, controller.signal)
      } finally {
        pending.delete(requestId)
      }
    })
  )
  ipc.handle(IPC_INVOKE.providerCancelConnectionTest, (_event, input: unknown) =>
    wrap(async () => {
      const parsed = testConnectionRequestIdSchema.safeParse(input)
      if (!parsed.success) throw new ValidationError('Invalid connection test ID')
      pending.get(parsed.data)?.abort()
    })
  )
}
