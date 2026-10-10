import { BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import { IPC_INVOKE } from '@shared/ipc/channels'
import {
  universalQuerySchema,
  universalReadSchema,
  universalMapSchema,
  universalIdSchema,
  universalWatchSchema,
  universalProviderInputSchema,
  handoffInputSchema
} from '@shared/universal/schema'
import { noArgsSchema } from '@shared/schemas/ipc'
import { sessionIdSchema } from '@shared/schemas/workspace'
import { ValidationError } from '../services/errors'
import type { UniversalSessionService } from '../universal/service'
import type { UniversalHandoffService } from '../universal/handoff'
import type { FileAccessService } from '../files/file-access-service'
import type { IpcHandleRegistrar } from './trusted-ipc'

export function registerUniversalIpc(
  ipc: IpcHandleRegistrar,
  wrapRequest: <T>(fn: () => Promise<T>) => Promise<unknown>,
  history: UniversalSessionService,
  handoff: UniversalHandoffService,
  access: FileAccessService
): void {
  const wrap = <T>(fn: () => Promise<T>) => wrapRequest(async () => fn())
  function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value)
    if (!result.success) throw new ValidationError('Invalid history request.')
    return result.data
  }
  ipc.handle(IPC_INVOKE.universalOrigin, (_e, input: unknown) =>
    wrap(() => handoff.origin(parse(sessionIdSchema, input)))
  )
  ipc.handle(IPC_INVOKE.universalList, (_e, input: unknown) =>
    wrap(() => history.list(parse(universalQuerySchema, input ?? {})))
  )
  ipc.handle(IPC_INVOKE.universalRead, (_e, input: unknown) =>
    wrap(() => history.read(parse(universalReadSchema, input)))
  )
  ipc.handle(IPC_INVOKE.universalSources, (_e, ...args: unknown[]) =>
    wrap(async () => {
      parse(noArgsSchema, args)
      return history.sources()
    })
  )
  ipc.handle(IPC_INVOKE.universalSync, (_e, ...args: unknown[]) =>
    wrap(async () => {
      parse(noArgsSchema, args)
      return history.sync()
    })
  )
  ipc.handle(IPC_INVOKE.universalCancel, (_e, ...args: unknown[]) =>
    wrap(async () => {
      parse(noArgsSchema, args)
      await history.cancelSync()
    })
  )
  ipc.handle(IPC_INVOKE.universalStatus, (_e, ...args: unknown[]) =>
    wrap(async () => {
      parse(noArgsSchema, args)
      return history.status()
    })
  )
  ipc.handle(IPC_INVOKE.universalWatch, (_e, input: unknown) =>
    wrap(() => history.setWatch(parse(universalWatchSchema, input).enabled))
  )
  ipc.handle(IPC_INVOKE.universalClear, (_e, ...args: unknown[]) =>
    wrap(async () => {
      parse(noArgsSchema, args)
      await history.clear()
    })
  )
  ipc.handle(IPC_INVOKE.universalForget, (_e, input: unknown) =>
    wrap(() => history.forget(parse(universalIdSchema, input).id))
  )
  ipc.handle(IPC_INVOKE.universalAddSource, (event, input: unknown) =>
    wrap(async () => {
      const { provider } = parse(universalProviderInputSchema, input)
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = { properties: ['openDirectory'] as Array<'openDirectory'> }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      return result.canceled || !result.filePaths[0]
        ? null
        : history.addSource(provider, result.filePaths[0])
    })
  )
  ipc.handle(IPC_INVOKE.universalMap, (_e, input: unknown) =>
    wrap(async () => {
      const { id, workspacePath } = parse(universalMapSchema, input)
      return history.map(id, await access.assertAllowed(workspacePath, { mustExist: true }))
    })
  )
  ipc.handle(IPC_INVOKE.universalPreview, (_e, input: unknown) =>
    wrap(async () => {
      const { id, instruction } = parse(handoffInputSchema, input)
      return handoff.preview(id, instruction)
    })
  )
  ipc.handle(IPC_INVOKE.universalContinue, (_e, input: unknown) =>
    wrap(() => handoff.continue(parse(universalIdSchema, input).id))
  )
}
