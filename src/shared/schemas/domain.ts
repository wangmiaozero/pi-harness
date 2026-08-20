/**
 * Zod schemas for Pi-Switch IPC input validation.
 *
 * The renderer is untrusted. Every IPC handler re-validates input with these
 * schemas before acting — TypeScript types are not runtime safety.
 */

import { z } from 'zod'
import { piApiTypeSchema, piThinkingLevelSchema, piInputTypeSchema } from './pi'

/**
 * Provider key = models.json object key.
 * Must stay a single path segment (no / \\), but otherwise match real-world
 * ids: mixed case, digits, `_-.+` (e.g. `nvapi-4SasPSHM0Ilo`, `OpenAI`, `stepfun`).
 * Do NOT force lowercase — vendors use casing in ids and api-key-shaped tokens.
 */
const providerKeyRegex = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/

export const providerKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(providerKeyRegex, 'letters, digits, . _ + - ; must start with a letter or digit')

export const protocolIdSchema = piApiTypeSchema

export const apiKeySpecSchema = z.object({
  kind: z.enum(['literal', 'env', 'command', 'stored']),
  /** Opaque vendor secret — never format-validated (nvapi-…, sk-…, etc.). */
  literal: z.string().max(8_192).optional(),
  envRef: z.string().max(256).optional(),
  command: z.string().max(2_048).optional()
})

export const headerMapSchema = z.record(z.string(), z.string())

export const providerFormSchema = z.object({
  key: providerKeySchema,
  name: z.string().min(1).max(128),
  displayName: z.string().min(1).max(128),
  enabled: z.boolean(),
  protocol: protocolIdSchema,
  baseUrl: z.string().max(512),
  apiKey: apiKeySpecSchema.nullable(),
  headers: headerMapSchema,
  authHeader: z.boolean(),
  timeout: z.number().int().positive().nullable(),
  /** Optional default model id — auto-created under the provider if missing. */
  defaultModelId: z.string().min(1).max(256).nullable().optional()
})

export const modelFormSchema = z.object({
  providerId: z.string().min(1),
  /** Vendor model ids are free-form (e.g. `meta/llama3.1-70b`, `step-3.7-flash`). */
  modelId: z.string().min(1).max(256),
  displayName: z.string().min(1).max(256),
  protocol: protocolIdSchema,
  enabled: z.boolean(),
  reasoning: z.boolean(),
  vision: z.boolean(),
  tools: z.boolean(),
  streaming: z.boolean(),
  contextWindow: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  input: z.array(piInputTypeSchema).optional(),
  thinkingLevels: z.record(piThinkingLevelSchema, z.union([z.string(), z.null()])).optional()
})

export const setActiveModelSchema = z.object({
  providerKey: z.string().min(1),
  modelId: z.string().min(1)
})

export const backupIdSchema = z.string().min(1)

export const pathSegmentSchema = z
  .string()
  .max(1024)
  .refine((s) => !s.includes('\0'), 'no null bytes')

export const testConnectionSchema = z.object({
  providerKey: z.string().min(1),
  /** Optional — falls back to provider defaultModelId / first registered model. */
  modelId: z.string().max(256).optional().default('')
})

const skillNameRegex = /^[a-z0-9][a-z0-9._-]{0,63}$/

export const skillFormSchema = z.object({
  name: z.string().regex(skillNameRegex, 'lowercase letters/digits/._-; start with alnum; max 64'),
  description: z.string().max(500),
  content: z.string().min(1).max(64_000),
  targetRoot: pathSegmentSchema,
  /** Baseline mtime of SKILL.md when the editor opened (for conflict detection). */
  expectedMtime: z.number().int().nullable().optional(),
  /** Force overwrite when SKILL.md changed externally. */
  overwrite: z.boolean().optional()
})

export const skillImportSchema = z.object({
  source: pathSegmentSchema,
  targetRoot: pathSegmentSchema,
  name: z.string().regex(skillNameRegex),
  onConflict: z.enum(['rename', 'replace', 'cancel']).optional()
})

export type SkillForm = z.infer<typeof skillFormSchema>
export type SkillImportInput = z.infer<typeof skillImportSchema>

export type ProviderForm = z.infer<typeof providerFormSchema>
export type ModelForm = z.infer<typeof modelFormSchema>
export type ProviderKey = z.infer<typeof providerKeySchema>
