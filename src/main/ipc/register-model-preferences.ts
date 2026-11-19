import { z } from 'zod'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { ValidationError } from '../services/errors'
import type { ModelService } from '../services/model-service'
import type { ProviderService } from '../services/provider-service'
import type { IpcHandleRegistrar } from './trusted-ipc'

const visibilitySchema = z
  .array(
    z
      .object({
        id: z
          .string()
          .min(3)
          .max(512)
          .regex(/^[^:]+::.+$/),
        enabled: z.boolean()
      })
      .strict()
  )
  .min(1)
  .max(5000)

export function registerModelPreferences(
  ipc: IpcHandleRegistrar,
  wrap: <T>(run: () => Promise<T>) => Promise<unknown>,
  models: Pick<ModelService, 'setVisibility'>,
  providers: Pick<ProviderService, 'fastMode' | 'setFastMode'>
) {
  ipc.handle(IPC_INVOKE.modelSetVisibility, (_event, entries: unknown) =>
    wrap(async () => {
      const parsed = visibilitySchema.safeParse(entries)
      if (!parsed.success) throw new ValidationError('Invalid model visibility')
      return models.setVisibility(parsed.data)
    })
  )
  ipc.handle(IPC_INVOKE.modelFastMode, () => wrap(() => providers.fastMode()))
  ipc.handle(IPC_INVOKE.modelSetFastMode, (_event, enabled: unknown) =>
    wrap(async () => {
      const parsed = z.boolean().safeParse(enabled)
      if (!parsed.success) throw new ValidationError('Invalid fast mode')
      return providers.setFastMode(parsed.data)
    })
  )
}
