import { IPC_INVOKE } from '@shared/ipc/channels'
import {
  harnessCompactSchema,
  harnessQueueMessageSchema,
  harnessSessionInputSchema,
  harnessSetAutoCompactionSchema,
  harnessSetModelSchema,
  harnessSetThinkingSchema,
  harnessSetToolsSchema,
  harnessTreeActionSchema
} from '@shared/schemas/harness'
import { ValidationError } from '../services/errors'
import type { HarnessRuntime } from '../harness/harness-runtime'
import type { IpcHandleRegistrar } from './trusted-ipc'

type Wrap = <T>(
  fn: () => Promise<T>
) => Promise<{ ok: true; data: T } | { ok: false; error: unknown }>

export function registerHarnessIpc(
  ipcMain: IpcHandleRegistrar,
  wrap: Wrap,
  harness: HarnessRuntime
): void {
  ipcMain.handle(IPC_INVOKE.harnessGetState, (_event, input: unknown) =>
    wrap(async () => harness.getHarnessState(parse(harnessSessionInputSchema, input).sessionId))
  )
  ipcMain.handle(IPC_INVOKE.harnessGetTools, (_event, input: unknown) =>
    wrap(async () => harness.getHarnessTools(parse(harnessSessionInputSchema, input).sessionId))
  )
  ipcMain.handle(IPC_INVOKE.harnessSetTools, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessSetToolsSchema, input)
      await harness.setTools(value.sessionId, value.toolNames)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessSetModel, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessSetModelSchema, input)
      await harness.setModel(value.sessionId, value.provider, value.modelId)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessSetThinkingLevel, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessSetThinkingSchema, input)
      await harness.setThinkingLevel(value.sessionId, value.level)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessCompact, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessCompactSchema, input)
      return harness.compact(value.sessionId, value.instructions)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessAbortCompaction, (_event, input: unknown) =>
    wrap(async () => harness.abortCompaction(parse(harnessSessionInputSchema, input).sessionId))
  )
  ipcMain.handle(IPC_INVOKE.harnessSetAutoCompaction, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessSetAutoCompactionSchema, input)
      await harness.setAutoCompaction(value.sessionId, value.enabled)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessSteer, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessQueueMessageSchema, input)
      await harness.steer(value.sessionId, value.message, value.images)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessFollowUp, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessQueueMessageSchema, input)
      await harness.followUp(value.sessionId, value.message, value.images)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessFork, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessTreeActionSchema, input)
      return harness.fork(value.sessionId, value.entryId)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessNavigateTree, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessTreeActionSchema, input)
      return harness.navigateTree(value.sessionId, value.entryId)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessGetSession, (_event, input: unknown) =>
    wrap(async () => harness.getHarnessSession(parse(harnessSessionInputSchema, input).sessionId))
  )
  ipcMain.handle(IPC_INVOKE.harnessGetStats, (_event, input: unknown) =>
    wrap(async () => harness.getStats(parse(harnessSessionInputSchema, input).sessionId))
  )
  ipcMain.handle(IPC_INVOKE.harnessGetTimeline, (_event, input: unknown) =>
    wrap(async () => harness.getTimeline(parse(harnessSessionInputSchema, input).sessionId))
  )
}

function parse<T>(
  schema: {
    safeParse(
      input: unknown
    ): { success: true; data: T } | { success: false; error: { issues: unknown } }
  },
  input: unknown
): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success)
    throw new ValidationError('Invalid Harness request', { issues: parsed.error.issues })
  return parsed.data
}
