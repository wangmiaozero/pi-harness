import { z } from 'zod'
import {
  agentImageSchema,
  sessionIdSchema,
  thinkingLevelSchema,
  toolNamesSchema
} from './workspace'

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
  evaluation: z.strictObject({ autoEvaluate: z.boolean() }),
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
