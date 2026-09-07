import { IPC_INVOKE } from '@shared/ipc/channels'
import {
  harnessCheckpointActionSchema,
  harnessCompactSchema,
  harnessCreateCheckpointSchema,
  harnessEvaluateRunSchema,
  harnessQueueMessageSchema,
  harnessResumeCheckpointSchema,
  harnessRunInputSchema,
  harnessSessionInputSchema,
  harnessSetAutoCompactionSchema,
  harnessSetModelSchema,
  harnessSetPolicySchema,
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
  // ------------------------------------------------- Harness Control Plane
  ipcMain.handle(IPC_INVOKE.harnessListRuns, (_event, input: unknown) =>
    wrap(async () => harness.listRuns(parse(harnessSessionInputSchema, input).sessionId))
  )
  ipcMain.handle(IPC_INVOKE.harnessGetRun, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessRunInputSchema, input)
      return harness.getRun(value.sessionId, value.runId)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessGetPolicy, () => wrap(async () => harness.getPolicySnapshot()))
  ipcMain.handle(IPC_INVOKE.harnessSetPolicy, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessSetPolicySchema, input)
      return harness.updatePolicy(value.config)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessListCheckpoints, (_event, input: unknown) =>
    wrap(async () => harness.listCheckpoints(parse(harnessSessionInputSchema, input).sessionId))
  )
  ipcMain.handle(IPC_INVOKE.harnessCreateCheckpoint, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessCreateCheckpointSchema, input)
      return harness.createCheckpoint(value.sessionId, {
        reason: 'manual',
        ...(value.includeGit === undefined ? {} : { includeGit: value.includeGit })
      })
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessResumeCheckpoint, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessResumeCheckpointSchema, input)
      return harness.resumeCheckpoint(value.checkpointId, value.message)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessForkCheckpoint, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessCheckpointActionSchema, input)
      return harness.forkCheckpoint(value.checkpointId)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessRetryLastRun, (_event, input: unknown) =>
    wrap(async () => harness.retryLastRun(parse(harnessSessionInputSchema, input).sessionId))
  )
  ipcMain.handle(IPC_INVOKE.harnessEvaluateRun, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessEvaluateRunSchema, input)
      return harness.evaluateRun(value.sessionId, value.runId)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessListEvaluations, (_event, input: unknown) =>
    wrap(async () => harness.listEvaluations(parse(harnessSessionInputSchema, input).sessionId))
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
