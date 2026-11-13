import { z } from 'zod'
import { IPC_INVOKE } from '@shared/ipc/channels'
import type { LocalProviderGateway } from '../services/local-provider-gateway'
import { ValidationError } from '../services/errors'
import type { IpcHandleRegistrar } from './trusted-ipc'

const startInput = z.strictObject({ port: z.number().int().min(0).max(65535) })

export function registerLocalProviderGateway(
  ipc: IpcHandleRegistrar,
  wrap: <T>(run: () => Promise<T>) => Promise<unknown>,
  gateway: Pick<LocalProviderGateway, 'state' | 'start' | 'stop' | 'copyKey'>,
  copy: (value: string) => void
): void {
  ipc.handle(IPC_INVOKE.providerGatewayState, (_event, input) =>
    wrap(async () => {
      if (input !== undefined) throw new ValidationError('Invalid gateway status request')
      return gateway.state()
    })
  )
  ipc.handle(IPC_INVOKE.providerGatewayStart, (_event, input) =>
    wrap(async () => {
      const parsed = startInput.safeParse(input)
      if (!parsed.success) throw new ValidationError('Invalid gateway port')
      return gateway.start(parsed.data.port)
    })
  )
  ipc.handle(IPC_INVOKE.providerGatewayStop, (_event, input) =>
    wrap(async () => {
      if (input !== undefined) throw new ValidationError('Invalid gateway stop request')
      return gateway.stop()
    })
  )
  ipc.handle(IPC_INVOKE.providerGatewayCopyKey, (_event, input) =>
    wrap(async () => {
      if (input !== undefined) throw new ValidationError('Invalid gateway key request')
      gateway.copyKey(copy)
    })
  )
}
