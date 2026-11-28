import { expect, it, vi } from 'vitest'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { registerImageRequests } from './register-image-requests'
import type { ProviderService } from '../services/provider-service'
import type { IpcHandleRegistrar } from './trusted-ipc'

it('validates image requests and cancels only the matching generation', async () => {
  const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()
  const ipc = {
    handle: (channel: string, handler: never) => handlers.set(channel, handler)
  } as IpcHandleRegistrar
  const invokeImageModel = vi.fn<ProviderService['invokeImageModel']>(async (_input, signal) => {
    if (signal?.aborted) throw new Error('already aborted')
    if (signal) {
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      )
    }
    return { mimeType: 'image/png', base64: 'iVBORw==', revisedPrompt: null }
  })
  registerImageRequests(ipc, (run) => run(), { invokeImageModel })
  const run = (input: unknown) => handlers.get(IPC_INVOKE.modelInvokeImage)!(null, input)
  const cancel = (input: unknown) => handlers.get(IPC_INVOKE.modelCancelImage)!(null, input)
  const request = {
    providerKey: 'stepfun',
    modelId: 'step-3.7-flash',
    prompt: 'rain'
  }

  await expect(run({ ...request, requestId: 'bad' })).rejects.toThrow('Invalid image request ID')
  await expect(cancel('bad-id')).rejects.toThrow('Invalid image request ID')
  expect(invokeImageModel).not.toHaveBeenCalled()

  await expect(run(request)).resolves.toMatchObject({ mimeType: 'image/png' })
  const requestId = crypto.randomUUID()
  const pending = run({ ...request, requestId })
  await expect(run({ ...request, requestId })).rejects.toThrow('already running')
  await cancel(crypto.randomUUID())
  expect(invokeImageModel.mock.calls[1]?.[1]?.aborted).toBe(false)
  await cancel(requestId)
  await expect(pending).rejects.toThrow('cancelled')
  expect(invokeImageModel.mock.calls[1]?.[1]?.aborted).toBe(true)
})
