import { z } from 'zod'
import {
  HARNESS_PLUGIN_API_VERSION,
  PLUGIN_EVENT_TYPES
} from '../../../packages/harness-plugin-sdk'
import { pluginIdSchema } from '../../../packages/harness-plugin-sdk/manifest.mjs'
import type { HarnessEvent } from '../types/harness'
export {
  pluginIdSchema,
  permissionSchema,
  pluginManifestSchema,
  teamTemplateSchema,
  compatible
} from '../../../packages/harness-plugin-sdk/manifest.mjs'
PLUGIN_EVENT_TYPES satisfies readonly HarnessEvent['type'][]
export { HARNESS_PLUGIN_API_VERSION, PLUGIN_EVENT_TYPES }
const key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
const text = z.string().trim().min(1).max(500)
import semver from 'semver'
const version = z
  .string()
  .max(64)
  .refine((v) => semver.valid(v) === v, 'Expected exact SemVer')
const number = z.number().finite().nonnegative()
export const evidenceSchema = z.strictObject({
  runId: z.string().min(1).max(128),
  status: z.string().max(32),
  startedAt: number,
  finishedAt: number.nullable(),
  toolCallCount: number.int(),
  toolFailureCount: number.int(),
  totalTokens: number
})
export const traceSchema = z.strictObject({
  runId: z.string().min(1).max(128),
  source: z.enum(['recorded', 'reconstructed']),
  spans: z
    .array(
      z.strictObject({
        id: z.string().max(128),
        type: z.string().max(32),
        status: z.string().max(32),
        startedAt: number,
        duration: number.nullable()
      })
    )
    .max(2000)
})
export const eventSchema = z.strictObject({
  sessionId: z.string().min(1).max(128),
  event: z.strictObject({
    type: z.enum(PLUGIN_EVENT_TYPES),
    timestamp: number,
    runId: z.string().max(128).optional(),
    status: z.string().max(32).optional(),
    toolName: z.string().max(128).optional(),
    isError: z.boolean().optional()
  })
})
// JSON result size/depth is bounded before recursive parsing at the process boundary.
export const jsonSchema: z.ZodType<import('../../../packages/harness-plugin-sdk').JsonValue> =
  z.lazy(() =>
    z.union([
      z.null(),
      z.boolean(),
      z.number().finite(),
      z.string().max(16000),
      z.array(jsonSchema).max(2000),
      z.record(z.string().max(100), jsonSchema)
    ])
  )
export const evaluatorResultSchema = z.strictObject({
  evaluatorId: key,
  version,
  score: z.number().finite().min(0).max(100),
  status: z.enum(['passed', 'warning', 'failed']),
  findings: z
    .array(
      z.strictObject({ code: key, severity: z.enum(['info', 'warning', 'error']), message: text })
    )
    .max(100),
  metadata: z.record(z.string().max(100), jsonSchema)
})
export const pluginTargetSchema = z.strictObject({ id: pluginIdSchema })
export const pluginToggleSchema = pluginTargetSchema.extend({ enabled: z.boolean() })
export const pluginRunSchema = pluginTargetSchema.extend({
  contributionId: key,
  sessionId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128)
})
export const pluginTemplateInputSchema = pluginTargetSchema.extend({ contributionId: key })
