/**
 * IPC registration for the Universal Runtime surface.
 *
 * Every channel is schema-validated. Session creation enforces the same
 * workspace authorization boundary as the native Pi agent start path
 * (`access.assertAllowed`), so a renderer can never point a runtime agent
 * outside authorized roots. Capabilities are re-checked in the registry
 * backend, not only hidden in the UI.
 */

import { z } from 'zod'
import { IPC_INVOKE } from '@shared/ipc/channels'
import {
  noArgsSchema
} from '@shared/schemas/ipc'
import {
  universalSessionCancelSchema,
  universalSessionCloseSchema,
  universalSessionCreateSchema,
  universalSessionPromptSchema,
  universalSessionRespondPermissionSchema,
  universalSessionRuntimeFilterSchema,
  runtimeEnableSchema
} from '@shared/universal-runtime/schema'
import { ValidationError } from '../services/errors'
import type { FileAccessService } from '../files/file-access-service'
import type { UniversalRuntimeService } from '../universal-runtime/service'
import type { IpcHandleRegistrar } from './trusted-ipc'

export function registerUniversalRuntimesIpc(
  ipc: IpcHandleRegistrar,
  wrapRequest: <T>(fn: () => Promise<T>) => Promise<unknown>,
  runtimes: UniversalRuntimeService,
  access: FileAccessService
): void {
  const wrap = <T>(fn: () => Promise<T>) => wrapRequest(async () => fn())
  function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
    const result = schema.safeParse(value)
    if (!result.success) throw new ValidationError(message, { issues: result.error.issues })
    return result.data
  }

  ipc.handle(IPC_INVOKE.universalRuntimesList, (_e, ...args: unknown[]) =>
    wrap(async () => {
      parse(noArgsSchema, args, 'Invalid runtimes request')
      return runtimes.listRuntimes()
    })
  )

  ipc.handle(IPC_INVOKE.universalRuntimesHealth, (_e, ...args: unknown[]) =>
    wrap(async () => {
      parse(noArgsSchema, args, 'Invalid runtimes request')
      return runtimes.healthCheckAll()
    })
  )

  ipc.handle(IPC_INVOKE.universalRuntimesSetEnabled, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = parse(runtimeEnableSchema, input, 'Invalid runtime toggle')
      return runtimes.setEnabled(parsed.runtimeId, parsed.enabled)
    })
  )

  ipc.handle(IPC_INVOKE.universalSessionsList, (_e, input: unknown) =>
    wrap(async () =>
      runtimes.listSessions(parse(universalSessionRuntimeFilterSchema, input, 'Invalid session filter'))
    )
  )

  ipc.handle(IPC_INVOKE.universalSessionsCreate, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = parse(universalSessionCreateSchema, input, 'Invalid session create')
      if (parsed.resumeSessionId) {
        // Resume re-binds an existing engine session; the persisted workspace
        // is re-validated by the engine itself, but a fresh cwd must be
        // authorized first.
        if (parsed.cwd) await access.assertAllowed(parsed.cwd, { mustExist: true })
      } else {
        await access.assertAllowed(parsed.cwd, { mustExist: true })
      }
      return runtimes.createSession(parsed)
    })
  )

  ipc.handle(IPC_INVOKE.universalSessionsPrompt, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = parse(universalSessionPromptSchema, input, 'Invalid prompt')
      return runtimes.prompt(parsed.sessionId, parsed.message)
    })
  )

  ipc.handle(IPC_INVOKE.universalSessionsCancel, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = parse(universalSessionCancelSchema, input, 'Invalid cancel')
      await runtimes.cancel(parsed.sessionId)
      return null
    })
  )

  ipc.handle(IPC_INVOKE.universalSessionsClose, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = parse(universalSessionCloseSchema, input, 'Invalid close')
      await runtimes.closeSession(parsed.sessionId)
      return null
    })
  )

  ipc.handle(IPC_INVOKE.universalSessionsRespondPermission, (_e, input: unknown) =>
    wrap(async () => {
      const parsed = parse(
        universalSessionRespondPermissionSchema,
        input,
        'Invalid permission response'
      )
      await runtimes.respondToPermission(parsed.requestId, parsed.outcome)
      return null
    })
  )
}
