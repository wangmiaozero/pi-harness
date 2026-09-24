import { IPC_INVOKE } from '@shared/ipc/channels'
import {
  harnessCheckpointActionSchema,
  harnessCompareRunsSchema,
  harnessCompactSchema,
  harnessCreateCheckpointSchema,
  harnessEvaluateRunSchema,
  harnessExportDebugBundleSchema,
  harnessExportRunSchema,
  harnessForkRunSchema,
  harnessProjectStatsSchema,
  harnessListArtifactsSchema,
  harnessListRunsSchema,
  harnessQueueMessageSchema,
  harnessResumeCheckpointSchema,
  harnessBaselineSchema,
  harnessRunDetailSchema,
  harnessRunInputSchema,
  harnessSessionInputSchema,
  harnessSetAutoCompactionSchema,
  harnessSetModelSchema,
  harnessSetPolicySchema,
  harnessSetThinkingSchema,
  harnessSetToolsSchema,
  harnessStoreSettingsSchema,
  harnessTreeActionSchema,
  orchestrationAddAgentSchema,
  orchestrationAgentBudgetSchema,
  orchestrationAgentIdSchema,
  orchestrationCreateSchema,
  orchestrationCreateTaskSchema,
  orchestrationGetSchema,
  orchestrationListAgentsSchema,
  orchestrationListHandoffsSchema,
  orchestrationListTasksSchema,
  orchestrationPauseSchema,
  orchestrationReassignTaskSchema,
  orchestrationRetryTaskSchema,
  orchestrationSnapshotSchema,
  orchestrationTaskIdSchema,
  orchestrationTeamIdSchema,
  orchestrationTeamInputSchema,
  orchestrationTemplateIdSchema,
  orchestrationTemplateInputSchema,
  orchestrationUpdateAgentSchema,
  orchestrationUpdateTaskSchema
} from '@shared/schemas/harness'
import { ValidationError } from '../services/errors'
import type { HarnessRuntime } from '../harness/harness-runtime'
import type { OrchestratorService } from '../harness/orchestrator/orchestrator-service'
import type { IpcHandleRegistrar } from './trusted-ipc'

type Wrap = <T>(
  fn: () => Promise<T>
) => Promise<{ ok: true; data: T } | { ok: false; error: unknown }>

export function registerHarnessIpc(
  ipcMain: IpcHandleRegistrar,
  wrap: Wrap,
  harness: HarnessRuntime,
  orchestrator?: OrchestratorService
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
    wrap(async () => {
      const value = parse(harnessListRunsSchema, input)
      return harness.listRuns(value.sessionId, value.scope)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessGetRun, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessRunInputSchema, input)
      return harness.getRun(value.sessionId, value.runId)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessGetRunDetail, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessRunDetailSchema, input)
      return harness.getRunDetail(value.sessionId, value.runId)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessGetRunTree, (_event, input: unknown) =>
    wrap(async () => harness.getRunTree(parse(harnessSessionInputSchema, input).sessionId))
  )
  ipcMain.handle(IPC_INVOKE.harnessCompareRuns, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessCompareRunsSchema, input)
      return harness.compareRuns(value.sessionId, value.runIdA, value.runIdB)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessForkRun, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessForkRunSchema, input)
      return harness.forkRun(value.sessionId, value.runId, {
        mode: value.mode,
        ...(value.fromEventId === undefined ? {} : { fromEventId: value.fromEventId }),
        ...(value.fromCheckpointId === undefined
          ? {}
          : { fromCheckpointId: value.fromCheckpointId }),
        ...(value.message === undefined ? {} : { message: value.message })
      })
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessSetBaseline, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessBaselineSchema, input)
      return harness.setBaseline(value.sessionId, value.runId)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessGetBaseline, (_event, input: unknown) =>
    wrap(async () => harness.getBaseline(parse(harnessSessionInputSchema, input).sessionId))
  )
  ipcMain.handle(IPC_INVOKE.harnessGetProjectStats, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessProjectStatsSchema, input)
      return harness.getProjectStats(value.sessionId, value.range)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessExportRun, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessExportRunSchema, input)
      return harness.exportRun(value.sessionId, value.runId, value.format)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessExportDebugBundle, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessExportDebugBundleSchema, input)
      return harness.exportDebugBundle(value.sessionId, value.runId)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessListArtifacts, (_event, input: unknown) =>
    wrap(async () => {
      const value = parse(harnessListArtifactsSchema, input)
      return harness.listArtifacts(value.sessionId, value.runId)
    })
  )
  ipcMain.handle(IPC_INVOKE.harnessGetStoreSettings, () =>
    wrap(async () => harness.getStoreSettings())
  )
  ipcMain.handle(IPC_INVOKE.harnessUpdateStoreSettings, (_event, input: unknown) =>
    wrap(async () => harness.updateStoreSettings(parse(harnessStoreSettingsSchema, input)))
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

  // ---------------------------------------------------- orchestration plane

  if (orchestrator) {
    const orch = orchestrator
    ipcMain.handle(IPC_INVOKE.orchestrationList, () => wrap(async () => orch.listOrchestrations()))
    ipcMain.handle(IPC_INVOKE.orchestrationGet, (_event, input: unknown) =>
      wrap(async () => orch.getOrchestration(parse(orchestrationGetSchema, input).orchestrationId))
    )
    ipcMain.handle(IPC_INVOKE.orchestrationCreate, (_event, input: unknown) =>
      wrap(async () => {
        const value = parse(orchestrationCreateSchema, input)
        return orch.createOrchestration({
          name: value.name ?? null,
          cwd: value.cwd,
          strategy: value.strategy,
          teamId: value.teamId ?? null,
          templateIds: value.templateIds,
          maxConcurrentAgents: value.maxConcurrentAgents,
          maxConcurrentRuns: value.maxConcurrentRuns,
          budget: value.budget
        })
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationDelete, (_event, input: unknown) =>
      wrap(async () => {
        await orch.deleteOrchestration(parse(orchestrationGetSchema, input).orchestrationId)
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationStart, (_event, input: unknown) =>
      wrap(async () => orch.start(parse(orchestrationGetSchema, input).orchestrationId))
    )
    ipcMain.handle(IPC_INVOKE.orchestrationPause, (_event, input: unknown) =>
      wrap(async () => {
        const value = parse(orchestrationPauseSchema, input)
        return orch.pause(value.orchestrationId, value.reason)
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationResume, (_event, input: unknown) =>
      wrap(async () => orch.resume(parse(orchestrationGetSchema, input).orchestrationId))
    )
    ipcMain.handle(IPC_INVOKE.orchestrationAbort, (_event, input: unknown) =>
      wrap(async () => orch.abort(parse(orchestrationGetSchema, input).orchestrationId))
    )
    ipcMain.handle(IPC_INVOKE.orchestrationSnapshot, (_event, input: unknown) =>
      wrap(async () => orch.snapshot(parse(orchestrationSnapshotSchema, input).orchestrationId))
    )
    ipcMain.handle(IPC_INVOKE.orchestrationListTemplates, () =>
      wrap(async () => orch.listTemplates())
    )
    ipcMain.handle(IPC_INVOKE.orchestrationSaveTemplate, (_event, input: unknown) =>
      wrap(async () => {
        const value = parse(orchestrationTemplateInputSchema, input)
        return value.id ? orch.updateTemplate(value.id, value) : orch.createTemplate(value)
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationDeleteTemplate, (_event, input: unknown) =>
      wrap(async () => {
        await orch.deleteTemplate(parse(orchestrationTemplateIdSchema, input).templateId)
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationListTeams, () => wrap(async () => orch.listTeams()))
    ipcMain.handle(IPC_INVOKE.orchestrationSaveTeam, (_event, input: unknown) =>
      wrap(async () => {
        const value = parse(orchestrationTeamInputSchema, input)
        return value.id ? orch.updateTeam(value.id, value) : orch.createTeam(value)
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationDeleteTeam, (_event, input: unknown) =>
      wrap(async () => {
        await orch.deleteTeam(parse(orchestrationTeamIdSchema, input).teamId)
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationListAgents, (_event, input: unknown) =>
      wrap(async () =>
        orch.listAgents(
          input === undefined || input === null
            ? undefined
            : parse(orchestrationListAgentsSchema, input).orchestrationId
        )
      )
    )
    ipcMain.handle(IPC_INVOKE.orchestrationAddAgent, (_event, input: unknown) =>
      wrap(async () => {
        const value = parse(orchestrationAddAgentSchema, input)
        return orch.addAgent(
          value.orchestrationId,
          {
            name: value.name,
            role: value.role,
            description: value.description ?? null,
            provider: value.provider ?? null,
            modelId: value.modelId ?? null,
            thinkingLevel: value.thinkingLevel ?? null,
            toolNames: value.toolNames ?? null,
            skillIds: value.skillIds ?? [],
            workspaceMode: value.workspaceMode,
            isReviewer: value.isReviewer,
            budget: value.budget
          },
          value.templateId ?? null
        )
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationUpdateAgent, (_event, input: unknown) =>
      wrap(async () => {
        const value = parse(orchestrationUpdateAgentSchema, input)
        const { agentId, ...patch } = value
        return orch.updateAgent(agentId, patch)
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationDeleteAgent, (_event, input: unknown) =>
      wrap(async () => {
        await orch.deleteAgent(parse(orchestrationAgentIdSchema, input).agentId)
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationSetAgentBudget, (_event, input: unknown) =>
      wrap(async () => {
        const value = parse(orchestrationAgentBudgetSchema, input)
        return orch.updateAgent(value.agentId, { budget: value.budget })
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationListTasks, (_event, input: unknown) =>
      wrap(async () =>
        orch.listTasks(
          input === undefined || input === null
            ? undefined
            : parse(orchestrationListTasksSchema, input).orchestrationId
        )
      )
    )
    ipcMain.handle(IPC_INVOKE.orchestrationCreateTask, (_event, input: unknown) =>
      wrap(async () => orch.createTask(parse(orchestrationCreateTaskSchema, input)))
    )
    ipcMain.handle(IPC_INVOKE.orchestrationUpdateTask, (_event, input: unknown) =>
      wrap(async () => {
        const value = parse(orchestrationUpdateTaskSchema, input)
        const { taskId, ...patch } = value
        return orch.updateTask(taskId, patch)
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationDeleteTask, (_event, input: unknown) =>
      wrap(async () => {
        await orch.deleteTask(parse(orchestrationTaskIdSchema, input).taskId)
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationRetryTask, (_event, input: unknown) =>
      wrap(async () => orch.retryTask(parse(orchestrationRetryTaskSchema, input)))
    )
    ipcMain.handle(IPC_INVOKE.orchestrationSkipTask, (_event, input: unknown) =>
      wrap(async () => orch.skipTask(parse(orchestrationTaskIdSchema, input).taskId))
    )
    ipcMain.handle(IPC_INVOKE.orchestrationReassignTask, (_event, input: unknown) =>
      wrap(async () => {
        const value = parse(orchestrationReassignTaskSchema, input)
        return orch.reassignTask(value.taskId, value.agentId)
      })
    )
    ipcMain.handle(IPC_INVOKE.orchestrationListHandoffs, (_event, input: unknown) =>
      wrap(async () =>
        orch.listHandoffs(
          input === undefined || input === null
            ? undefined
            : parse(orchestrationListHandoffsSchema, input).orchestrationId
        )
      )
    )
  }
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
