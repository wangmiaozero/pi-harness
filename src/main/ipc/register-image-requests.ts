import { IPC_INVOKE } from '@shared/ipc/channels'
import { testConnectionRequestIdSchema } from '@shared/schemas/domain'
import { ValidationError } from '../services/errors'
import type { ProviderService } from '../services/provider-service'
import type { IpcHandleRegistrar } from './trusted-ipc'

export function registerImageRequests(
  ipc: IpcHandleRegistrar,
  wrap: <T>(run: () => Promise<T>) => Promise<unknown>,
  providers: Pick<ProviderService, 'invokeImageModel'>
) {
  const pending = new Map<string, AbortController>()
  ipc.handle(IPC_INVOKE.modelInvokeImage, (_event, input: unknown) =>
    wrap(async () => {
      const { requestId, body } = splitImageRequest(input)
      if (!requestId) return providers.invokeImageModel(body)
      if (pending.has(requestId)) throw new ValidationError('Image request already running')
      const controller = new AbortController()
      pending.set(requestId, controller)
      try {
        return await providers.invokeImageModel(body, controller.signal)
      } finally {
        pending.delete(requestId)
      }
    })
  )
  ipc.handle(IPC_INVOKE.modelCancelImage, (_event, input: unknown) =>
    wrap(async () => {
      const parsed = testConnectionRequestIdSchema.safeParse(input)
      if (!parsed.success) throw new ValidationError('Invalid image request ID')
      pending.get(parsed.data)?.abort()
    })
  )
}

function splitImageRequest(input: unknown): { requestId?: string; body: unknown } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { body: input }
  const record = { ...(input as Record<string, unknown>) }
  const requestId = record.requestId
  delete record.requestId
  if (requestId === undefined) return { body: record }
  const parsed = testConnectionRequestIdSchema.safeParse(requestId)
  if (!parsed.success) throw new ValidationError('Invalid image request ID')
  return { requestId: parsed.data, body: record }
}
