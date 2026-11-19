import { z } from 'zod'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { providerKeySchema } from '@shared/schemas/domain'
import { ValidationError } from '../services/errors'
import type { ProviderService } from '../services/provider-service'
import type { IpcHandleRegistrar } from './trusted-ipc'

export function registerProviderGatewaySwitch(
  ipc: IpcHandleRegistrar,
  wrap: <T>(run: () => Promise<T>) => Promise<unknown>,
  providers: Pick<ProviderService, 'setGateway'>
) {
  ipc.handle(IPC_INVOKE.providerSetGateway, (_event, key: unknown, enabled: unknown) =>
    wrap(async () => {
      const parsedKey = providerKeySchema.safeParse(key)
      if (!parsedKey.success) throw new ValidationError('Invalid provider key')
      const parsedEnabled = z.boolean().safeParse(enabled)
      if (!parsedEnabled.success) throw new ValidationError('Invalid gateway state')
      return providers.setGateway(parsedKey.data, parsedEnabled.data)
    })
  )
}
