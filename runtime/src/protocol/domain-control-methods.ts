/**
 * Phase 3 domain RPC: harness control plane + orchestration.
 *
 * Mirrors Electron `register-harness.ts` control-plane / orchestration
 * handlers so the Tauri bridge stays a pure forwarder.
 */

import { requireString, optionalString, RuntimeError } from '../pi/errors.js'
import type { RuntimeServices } from '../services.js'
import type { RpcHandler, RpcParams } from './dispatch.js'
import type { HarnessPolicyConfig, HarnessStatsRange, HarnessStoreSettings } from '../harness-control/types.js'

type MethodMap = Record<string, RpcHandler>

function optionalBoolean(params: RpcParams, key: string): boolean | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new RuntimeError('INVALID_INPUT', `Parameter "${key}" must be a boolean`)
  }
  return value
}

function optionalNumber(params: RpcParams, key: string): number | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RuntimeError('INVALID_INPUT', `Parameter "${key}" must be a number`)
  }
  return value
}

function optionalStringArray(params: RpcParams, key: string): string[] | undefined {
  const value = params[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new RuntimeError('INVALID_INPUT', `Parameter "${key}" must be an array of strings`)
  }
  return value as string[]
}

function optionalObject(params: RpcParams, key: string): Record<string, unknown> | undefined {
  const value = params[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeError('INVALID_INPUT', `Parameter "${key}" must be an object`)
  }
  return value as Record<string, unknown>
}

export function registerControlPlaneMethods(methods: MethodMap, services: RuntimeServices): void {
  const { control, orchestration } = services

  methods['harness.listRuns'] = async (params) => {
    const scope = optionalString(params, 'scope')
    return control.listRuns(
      requireString(params, 'sessionId'),
      scope === 'project' ? 'project' : 'session'
    )
  }
  methods['harness.getRun'] = async (params) =>
    control.getRun(requireString(params, 'sessionId'), requireString(params, 'runId'))
  methods['harness.getRunDetail'] = async (params) =>
    control.getRunDetail(requireString(params, 'sessionId'), requireString(params, 'runId'))
  methods['harness.getRunTree'] = async (params) =>
    control.getRunTree(requireString(params, 'sessionId'))
  methods['harness.compareRuns'] = async (params) =>
    control.compareRuns(
      requireString(params, 'sessionId'),
      requireString(params, 'runIdA'),
      requireString(params, 'runIdB')
    )
  methods['harness.forkRun'] = async (params) => {
    const mode = optionalString(params, 'mode')
    return control.forkRun(requireString(params, 'sessionId'), requireString(params, 'runId'), {
      ...(mode === 'fork' || mode === 'rerun' ? { mode } : {}),
      ...(optionalString(params, 'fromEventId')
        ? { fromEventId: optionalString(params, 'fromEventId') }
        : {}),
      ...(optionalString(params, 'fromCheckpointId')
        ? { fromCheckpointId: optionalString(params, 'fromCheckpointId') }
        : {}),
      ...(optionalString(params, 'message') ? { message: optionalString(params, 'message') } : {})
    })
  }
  methods['harness.getBaseline'] = async (params) =>
    control.getBaseline(requireString(params, 'sessionId'))
  methods['harness.setBaseline'] = async (params) =>
    control.setBaseline(requireString(params, 'sessionId'), requireString(params, 'runId'))
  methods['harness.getProjectStats'] = async (params) => {
    const range = (optionalString(params, 'range') ?? 'all') as HarnessStatsRange
    return control.getProjectStats(requireString(params, 'sessionId'), range)
  }
  methods['harness.exportRun'] = async (params) => {
    const format = optionalString(params, 'format') === 'markdown' ? 'markdown' : 'json'
    return control.exportRun(requireString(params, 'sessionId'), requireString(params, 'runId'), format)
  }
  methods['harness.exportDebugBundle'] = async (params) =>
    control.exportDebugBundle(requireString(params, 'sessionId'), optionalString(params, 'runId'))
  methods['harness.listArtifacts'] = async (params) =>
    control.listArtifacts(requireString(params, 'sessionId'), optionalString(params, 'runId'))
  methods['harness.getStoreSettings'] = async () => control.getStoreSettings()
  methods['harness.updateStoreSettings'] = async (params) => {
    const settings = optionalObject(params, 'settings') ?? params
    return control.updateStoreSettings(settings as unknown as HarnessStoreSettings)
  }
  methods['harness.getPolicy'] = async () => control.getPolicySnapshot()
  methods['harness.setPolicy'] = async (params) => {
    const config = (optionalObject(params, 'config') ?? params) as unknown as HarnessPolicyConfig
    return control.updatePolicy(config)
  }
  methods['harness.listCheckpoints'] = async (params) =>
    control.listCheckpoints(requireString(params, 'sessionId'))
  methods['harness.createCheckpoint'] = async (params) =>
    control.createCheckpoint(requireString(params, 'sessionId'), {
      reason: 'manual',
      ...(optionalBoolean(params, 'includeGit') === undefined
        ? {}
        : { includeGit: optionalBoolean(params, 'includeGit') })
    })
  methods['harness.resumeCheckpoint'] = async (params) =>
    control.resumeCheckpoint(requireString(params, 'checkpointId'), optionalString(params, 'message'))
  methods['harness.forkCheckpoint'] = async (params) =>
    control.forkCheckpoint(requireString(params, 'checkpointId'))
  methods['harness.retryLastRun'] = async (params) =>
    control.retryLastRun(requireString(params, 'sessionId'))
  methods['harness.evaluateRun'] = async (params) =>
    control.evaluateRun(requireString(params, 'sessionId'), requireString(params, 'runId'))
  methods['harness.listEvaluations'] = async (params) =>
    control.listEvaluations(requireString(params, 'sessionId'))

  methods['orchestration.list'] = async () => orchestration.listOrchestrations()
  methods['orchestration.get'] = async (params) =>
    orchestration.getOrchestration(requireString(params, 'orchestrationId'))
  methods['orchestration.create'] = async (params) => {
    const budget = optionalObject(params, 'budget')
    return orchestration.createOrchestration({
      name: optionalString(params, 'name') ?? null,
      cwd: requireString(params, 'cwd'),
      strategy: ((): 'manual' | 'sequential' | 'dependency' | undefined => {
        const value = optionalString(params, 'strategy')
        return value === 'manual' || value === 'sequential' || value === 'dependency'
          ? value
          : undefined
      })(),
      teamId: optionalString(params, 'teamId') ?? null,
      templateIds: optionalStringArray(params, 'templateIds'),
      maxConcurrentAgents: optionalNumber(params, 'maxConcurrentAgents'),
      maxConcurrentRuns: optionalNumber(params, 'maxConcurrentRuns'),
      budget: budget
        ? {
            maxCost: typeof budget.maxCost === 'number' ? budget.maxCost : null,
            maxTokens: typeof budget.maxTokens === 'number' ? budget.maxTokens : null
          }
        : undefined
    })
  }
  methods['orchestration.delete'] = async (params) => {
    await orchestration.deleteOrchestration(requireString(params, 'orchestrationId'))
    return null
  }
  methods['orchestration.start'] = async (params) =>
    orchestration.start(requireString(params, 'orchestrationId'))
  methods['orchestration.pause'] = async (params) =>
    orchestration.pause(requireString(params, 'orchestrationId'), optionalString(params, 'reason'))
  methods['orchestration.resume'] = async (params) =>
    orchestration.resume(requireString(params, 'orchestrationId'))
  methods['orchestration.abort'] = async (params) =>
    orchestration.abort(requireString(params, 'orchestrationId'))
  methods['orchestration.snapshot'] = async (params) =>
    orchestration.snapshot(requireString(params, 'orchestrationId'))

  methods['orchestration.listTemplates'] = async () => orchestration.listTemplates()
  methods['orchestration.saveTemplate'] = async (params) => {
    const id = optionalString(params, 'id')
    const input = {
      name: requireString(params, 'name'),
      role: requireString(params, 'role'),
      description: optionalString(params, 'description') ?? null,
      systemPrompt: optionalString(params, 'systemPrompt') ?? null,
      provider: optionalString(params, 'provider') ?? null,
      modelId: optionalString(params, 'modelId') ?? null,
      thinkingLevel: optionalString(params, 'thinkingLevel') ?? null,
      toolNames: optionalStringArray(params, 'toolNames') ?? null,
      skillIds: optionalStringArray(params, 'skillIds') ?? [],
      workspaceMode:
        optionalString(params, 'workspaceMode') === 'worktree' ? 'worktree' as const : 'shared' as const,
      isReviewer: optionalBoolean(params, 'isReviewer') === true
    }
    return id ? orchestration.updateTemplate(id, input) : orchestration.createTemplate(input)
  }
  methods['orchestration.deleteTemplate'] = async (params) => {
    await orchestration.deleteTemplate(requireString(params, 'templateId'))
    return null
  }
  methods['orchestration.listTeams'] = async () => orchestration.listTeams()
  methods['orchestration.saveTeam'] = async (params) => {
    const id = optionalString(params, 'id')
    const input = {
      name: requireString(params, 'name'),
      description: optionalString(params, 'description') ?? null,
      agentTemplateIds: optionalStringArray(params, 'agentTemplateIds') ?? []
    }
    return id ? orchestration.updateTeam(id, input) : orchestration.createTeam(input)
  }
  methods['orchestration.deleteTeam'] = async (params) => {
    await orchestration.deleteTeam(requireString(params, 'teamId'))
    return null
  }
  methods['orchestration.listAgents'] = async (params) =>
    orchestration.listAgents(optionalString(params, 'orchestrationId'))
  methods['orchestration.addAgent'] = async (params) =>
    orchestration.addAgent(
      requireString(params, 'orchestrationId'),
      {
        name: requireString(params, 'name'),
        role: requireString(params, 'role'),
        description: optionalString(params, 'description') ?? null,
        provider: optionalString(params, 'provider') ?? null,
        modelId: optionalString(params, 'modelId') ?? null,
        thinkingLevel: optionalString(params, 'thinkingLevel') ?? null,
        toolNames: optionalStringArray(params, 'toolNames') ?? null,
        skillIds: optionalStringArray(params, 'skillIds') ?? [],
        workspaceMode:
          optionalString(params, 'workspaceMode') === 'worktree' ? 'worktree' : 'shared',
        isReviewer: optionalBoolean(params, 'isReviewer') === true,
        budget: optionalObject(params, 'budget') as
          | { maxCost: number | null; maxTokens: number | null }
          | undefined
      },
      optionalString(params, 'templateId') ?? null
    )
  methods['orchestration.updateAgent'] = async (params) => {
    const { agentId: _id, ..._rest } = params
    return orchestration.updateAgent(requireString(params, 'agentId'), {
      ...(optionalString(params, 'name') ? { name: optionalString(params, 'name') } : {}),
      ...(optionalString(params, 'description') !== undefined
        ? { description: optionalString(params, 'description') ?? null }
        : {}),
      ...(optionalString(params, 'provider') !== undefined
        ? { provider: optionalString(params, 'provider') ?? null }
        : {}),
      ...(optionalString(params, 'modelId') !== undefined
        ? { modelId: optionalString(params, 'modelId') ?? null }
        : {}),
      ...(optionalString(params, 'thinkingLevel') !== undefined
        ? { thinkingLevel: optionalString(params, 'thinkingLevel') ?? null }
        : {}),
      ...(optionalStringArray(params, 'toolNames') !== undefined
        ? { toolNames: optionalStringArray(params, 'toolNames') ?? null }
        : {}),
      ...(optionalObject(params, 'budget')
        ? {
            budget: optionalObject(params, 'budget') as {
              maxCost: number | null
              maxTokens: number | null
            }
          }
        : {})
    })
  }
  methods['orchestration.deleteAgent'] = async (params) => {
    await orchestration.deleteAgent(requireString(params, 'agentId'))
    return null
  }
  methods['orchestration.setAgentBudget'] = async (params) =>
    orchestration.updateAgent(requireString(params, 'agentId'), {
      budget: (optionalObject(params, 'budget') ?? {
        maxCost: null,
        maxTokens: null
      }) as { maxCost: number | null; maxTokens: number | null }
    })
  methods['orchestration.listTasks'] = async (params) =>
    orchestration.listTasks(optionalString(params, 'orchestrationId'))
  methods['orchestration.createTask'] = async (params) =>
    orchestration.createTask({
      orchestrationId: requireString(params, 'orchestrationId'),
      title: requireString(params, 'title'),
      description: optionalString(params, 'description') ?? null,
      priority: ((): 'low' | 'normal' | 'high' | 'critical' => {
        const value = optionalString(params, 'priority')
        return value === 'low' || value === 'high' || value === 'critical' ? value : 'normal'
      })(),
      assignedAgentId: optionalString(params, 'assignedAgentId') ?? null,
      parentTaskId: optionalString(params, 'parentTaskId') ?? null,
      dependencies: optionalStringArray(params, 'dependencies') ?? [],
      inputArtifactIds: optionalStringArray(params, 'inputArtifactIds') ?? [],
      reviewRequired: optionalBoolean(params, 'reviewRequired') === true
    })
  methods['orchestration.updateTask'] = async (params) =>
    orchestration.updateTask(requireString(params, 'taskId'), {
      ...(optionalString(params, 'title') ? { title: optionalString(params, 'title') } : {}),
      ...(optionalString(params, 'description') !== undefined
        ? { description: optionalString(params, 'description') ?? null }
        : {}),
      ...(optionalString(params, 'priority')
        ? {
            priority: optionalString(params, 'priority') as
              | 'low'
              | 'normal'
              | 'high'
              | 'critical'
          }
        : {}),
      ...(optionalString(params, 'assignedAgentId') !== undefined
        ? { assignedAgentId: optionalString(params, 'assignedAgentId') ?? null }
        : {}),
      ...(optionalString(params, 'parentTaskId') !== undefined
        ? { parentTaskId: optionalString(params, 'parentTaskId') ?? null }
        : {}),
      ...(optionalStringArray(params, 'dependencies')
        ? { dependencies: optionalStringArray(params, 'dependencies') }
        : {}),
      ...(optionalStringArray(params, 'inputArtifactIds')
        ? { inputArtifactIds: optionalStringArray(params, 'inputArtifactIds') }
        : {}),
      ...(optionalBoolean(params, 'reviewRequired') !== undefined
        ? { reviewRequired: optionalBoolean(params, 'reviewRequired') }
        : {})
    })
  methods['orchestration.deleteTask'] = async (params) => {
    await orchestration.deleteTask(requireString(params, 'taskId'))
    return null
  }
  methods['orchestration.retryTask'] = async (params) =>
    orchestration.retryTask({
      taskId: requireString(params, 'taskId'),
      agentId: optionalString(params, 'agentId') ?? null
    })
  methods['orchestration.skipTask'] = async (params) =>
    orchestration.skipTask(requireString(params, 'taskId'))
  methods['orchestration.reassignTask'] = async (params) =>
    orchestration.reassignTask(requireString(params, 'taskId'), requireString(params, 'agentId'))
  methods['orchestration.listHandoffs'] = async (params) =>
    orchestration.listHandoffs(optionalString(params, 'orchestrationId'))
}
