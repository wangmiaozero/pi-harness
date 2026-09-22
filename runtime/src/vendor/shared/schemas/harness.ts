// @ts-nocheck
import { z } from 'zod'
import {
  agentImageSchema,
  sessionIdSchema,
  thinkingLevelSchema,
  toolNamesSchema
} from './workspace.js'

export const harnessSessionInputSchema = z.strictObject({
  sessionId: sessionIdSchema
})

export const harnessSetToolsSchema = z.strictObject({
  sessionId: sessionIdSchema,
  toolNames: toolNamesSchema
})

export const harnessSetModelSchema = z.strictObject({
  sessionId: sessionIdSchema,
  provider: z.string().min(1).max(128),
  modelId: z.string().min(1).max(256)
})

export const harnessSetThinkingSchema = z.strictObject({
  sessionId: sessionIdSchema,
  level: thinkingLevelSchema
})

export const harnessCompactSchema = z.strictObject({
  sessionId: sessionIdSchema,
  instructions: z.string().max(20_000).optional()
})

export const harnessSetAutoCompactionSchema = z.strictObject({
  sessionId: sessionIdSchema,
  enabled: z.boolean()
})

export const harnessQueueMessageSchema = z
  .strictObject({
    sessionId: sessionIdSchema,
    message: z.string().max(200_000),
    images: z.array(agentImageSchema).max(8).optional()
  })
  .refine((input) => input.message.trim().length > 0 || Boolean(input.images?.length), {
    message: 'message or image is required'
  })

export const harnessTreeActionSchema = z.strictObject({
  sessionId: sessionIdSchema,
  entryId: z.string().min(1).max(128)
})

// ---------------------------------------------------------------------------
// Harness Control Plane — Runs / Policy / Checkpoints / Evaluation
// ---------------------------------------------------------------------------

export const harnessRunInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  runId: z.string().min(1).max(128)
})

const policyDecisionSchema = z.enum(['allow', 'ask', 'deny'])

const commandPatternSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => !/[\r\n]/.test(s), 'single-line patterns only')

const nullablePositiveNumber = z
  .number()
  .finite()
  .positive()
  .nullable()

export const harnessPolicyBudgetSchema = z.strictObject({
  maxTokens: nullablePositiveNumber,
  maxCost: nullablePositiveNumber,
  maxToolCalls: nullablePositiveNumber,
  maxRunDurationMs: nullablePositiveNumber
})

export const harnessPolicyConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  tools: z.strictObject({
    default: policyDecisionSchema,
    overrides: z.record(z.string().min(1).max(128), policyDecisionSchema)
  }),
  files: z.strictObject({
    write: policyDecisionSchema,
    delete: policyDecisionSchema,
    rename: policyDecisionSchema,
    outsideWorkspace: policyDecisionSchema
  }),
  shell: z.strictObject({
    default: policyDecisionSchema,
    allowCommands: z.array(commandPatternSchema).max(200),
    denyCommands: z.array(commandPatternSchema).max(200),
    dangerousConfirmation: z.boolean()
  }),
  git: z.strictObject({
    commit: policyDecisionSchema,
    push: policyDecisionSchema,
    forcePush: policyDecisionSchema,
    reset: policyDecisionSchema,
    checkout: policyDecisionSchema,
    branchDelete: policyDecisionSchema
  }),
  network: policyDecisionSchema,
  budget: harnessPolicyBudgetSchema,
  evaluation: z.strictObject({
    autoEvaluate: z.boolean(),
    preset: z.enum(['fast', 'standard', 'strict', 'custom']).default('standard'),
    customStages: z
      .array(
        z.enum([
          'static-check',
          'lint',
          'typecheck',
          'test',
          'build',
          'git-inspection',
          'custom-check'
        ])
      )
      .max(7)
      .default(['lint', 'test'])
  }),
  checkpoints: z.strictObject({ autoPreRun: z.boolean() })
})

export const harnessSetPolicySchema = z.strictObject({
  config: harnessPolicyConfigSchema
})

export const harnessCreateCheckpointSchema = z.strictObject({
  sessionId: sessionIdSchema,
  includeGit: z.boolean().optional()
})

export const harnessCheckpointActionSchema = z.strictObject({
  checkpointId: z.string().min(1).max(128)
})

export const harnessResumeCheckpointSchema = z.strictObject({
  checkpointId: z.string().min(1).max(128),
  message: z.string().max(200_000).optional()
})

export const harnessEvaluateRunSchema = z.strictObject({
  sessionId: sessionIdSchema,
  runId: z.string().min(1).max(128)
})

// ---------------------------------------------------------------------------
// Run Intelligence — Trace / Artifacts / Compare / Fork / Replay / Export
// ---------------------------------------------------------------------------

export const harnessRunTraceInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  runId: z.string().min(1).max(128)
})

export const harnessListArtifactsSchema = z.strictObject({
  sessionId: sessionIdSchema,
  runId: z.string().min(1).max(128).optional()
})

export const harnessRunDetailSchema = z.strictObject({
  sessionId: sessionIdSchema,
  runId: z.string().min(1).max(128)
})

export const harnessCompareRunsSchema = z.strictObject({
  sessionId: sessionIdSchema,
  runIdA: z.string().min(1).max(128),
  runIdB: z.string().min(1).max(128)
})

export const harnessListRunsSchema = z.strictObject({
  sessionId: sessionIdSchema,
  scope: z.enum(['session', 'project']).default('session')
})

export const harnessForkRunSchema = z.strictObject({
  sessionId: sessionIdSchema,
  runId: z.string().min(1).max(128),
  mode: z.enum(['fork', 'rerun']).default('fork'),
  fromEventId: z.string().min(1).max(128).optional(),
  fromCheckpointId: z.string().min(1).max(128).optional(),
  message: z.string().max(200_000).optional()
})

export const harnessBaselineSchema = z.strictObject({
  sessionId: sessionIdSchema,
  runId: z.string().min(1).max(128)
})

export const harnessProjectStatsSchema = z.strictObject({
  sessionId: sessionIdSchema,
  range: z.enum(['today', '7d', '30d', 'all']).default('7d')
})

export const harnessExportRunSchema = z.strictObject({
  sessionId: sessionIdSchema,
  runId: z.string().min(1).max(128),
  format: z.enum(['json', 'markdown'])
})

export const harnessExportDebugBundleSchema = z.strictObject({
  sessionId: sessionIdSchema,
  runId: z.string().min(1).max(128).optional()
})

export const harnessStoreSettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  retentionDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)]),
  maxEventsPerRun: z.number().int().min(50).max(5000)
})

// ---------------------------------------------------------------------------
// Multi-Agent Orchestration — Agents / Tasks / Teams / Templates
// ---------------------------------------------------------------------------

const orchestrationIdSchema = z.string().min(1).max(128)
const taskIdSchema = z.string().min(1).max(128)
const agentIdSchema = z.string().min(1).max(128)
const templateIdSchema = z.string().min(1).max(128)
const teamIdSchema = z.string().min(1).max(128)

const orchestrationBudgetSchema = z.strictObject({
  maxCost: nullablePositiveNumber,
  maxTokens: nullablePositiveNumber
})

export const orchestrationGetSchema = z.strictObject({
  orchestrationId: orchestrationIdSchema
})

export const orchestrationCreateSchema = z.strictObject({
  name: z.string().max(200).optional(),
  cwd: z.string().min(1).max(2048),
  strategy: z.enum(['manual', 'sequential', 'dependency']).default('dependency'),
  teamId: teamIdSchema.nullable().optional(),
  templateIds: z.array(templateIdSchema).max(20).optional(),
  maxConcurrentAgents: z.number().int().min(1).max(10).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(10).optional(),
  budget: z
    .strictObject({
      maxCost: nullablePositiveNumber.optional(),
      maxTokens: nullablePositiveNumber.optional()
    })
    .optional()
})

export const orchestrationSnapshotSchema = z.strictObject({
  orchestrationId: orchestrationIdSchema
})

export const orchestrationTemplateInputSchema = z.strictObject({
  id: templateIdSchema.optional(),
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(60),
  description: z.string().max(2000).nullable().optional(),
  systemPrompt: z.string().max(20_000).nullable().optional(),
  provider: z.string().max(128).nullable().optional(),
  modelId: z.string().max(256).nullable().optional(),
  thinkingLevel: thinkingLevelSchema.nullable().optional(),
  toolNames: toolNamesSchema.nullable().optional(),
  skillIds: z.array(z.string().min(1).max(200)).max(50).optional(),
  workspaceMode: z.enum(['shared', 'worktree']).default('shared'),
  isReviewer: z.boolean().default(false)
})

export const orchestrationTemplateIdSchema = z.strictObject({
  templateId: templateIdSchema
})

export const orchestrationTeamInputSchema = z.strictObject({
  id: teamIdSchema.optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  agentTemplateIds: z.array(templateIdSchema).max(20)
})

export const orchestrationTeamIdSchema = z.strictObject({
  teamId: teamIdSchema
})

export const orchestrationListAgentsSchema = z.strictObject({
  orchestrationId: orchestrationIdSchema.optional()
})

export const orchestrationAddAgentSchema = z.strictObject({
  orchestrationId: orchestrationIdSchema,
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(60),
  description: z.string().max(2000).nullable().optional(),
  provider: z.string().max(128).nullable().optional(),
  modelId: z.string().max(256).nullable().optional(),
  thinkingLevel: thinkingLevelSchema.nullable().optional(),
  toolNames: toolNamesSchema.nullable().optional(),
  skillIds: z.array(z.string().min(1).max(200)).max(50).optional(),
  workspaceMode: z.enum(['shared', 'worktree']).default('shared'),
  isReviewer: z.boolean().default(false),
  templateId: templateIdSchema.nullable().optional(),
  budget: orchestrationBudgetSchema.optional()
})

export const orchestrationUpdateAgentSchema = z.strictObject({
  agentId: agentIdSchema,
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  provider: z.string().max(128).nullable().optional(),
  modelId: z.string().max(256).nullable().optional(),
  thinkingLevel: thinkingLevelSchema.nullable().optional(),
  toolNames: toolNamesSchema.nullable().optional(),
  budget: orchestrationBudgetSchema.optional()
})

export const orchestrationAgentIdSchema = z.strictObject({
  agentId: agentIdSchema
})

export const orchestrationAgentBudgetSchema = z.strictObject({
  agentId: agentIdSchema,
  budget: orchestrationBudgetSchema
})

export const orchestrationListTasksSchema = z.strictObject({
  orchestrationId: orchestrationIdSchema.optional()
})

export const orchestrationCreateTaskSchema = z.strictObject({
  orchestrationId: orchestrationIdSchema,
  title: z.string().min(1).max(300),
  description: z.string().max(20_000).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  assignedAgentId: agentIdSchema.nullable().optional(),
  parentTaskId: taskIdSchema.nullable().optional(),
  dependencies: z.array(taskIdSchema).max(100).optional(),
  inputArtifactIds: z.array(z.string().min(1).max(128)).max(100).optional(),
  reviewRequired: z.boolean().optional()
})

export const orchestrationUpdateTaskSchema = z.strictObject({
  taskId: taskIdSchema,
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(20_000).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  assignedAgentId: agentIdSchema.nullable().optional(),
  parentTaskId: taskIdSchema.nullable().optional(),
  dependencies: z.array(taskIdSchema).max(100).optional(),
  inputArtifactIds: z.array(z.string().min(1).max(128)).max(100).optional(),
  reviewRequired: z.boolean().optional()
})

export const orchestrationTaskIdSchema = z.strictObject({
  taskId: taskIdSchema
})

export const orchestrationRetryTaskSchema = z.strictObject({
  taskId: taskIdSchema,
  agentId: agentIdSchema.nullable().optional()
})

export const orchestrationReassignTaskSchema = z.strictObject({
  taskId: taskIdSchema,
  agentId: agentIdSchema
})

export const orchestrationListHandoffsSchema = z.strictObject({
  orchestrationId: orchestrationIdSchema.optional()
})

export const orchestrationPauseSchema = z.strictObject({
  orchestrationId: orchestrationIdSchema,
  reason: z.string().max(500).optional()
})
