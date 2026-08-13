/**
 * Zod schemas for Pi's native configuration.
 *
 * All object schemas use `z.looseObject` so that unknown fields are preserved
 * on round-trip (requirement: "配置必须 Round-trip Safe" — saving a model must
 * not delete `futurePiField`). This is the Zod 4 replacement for `.passthrough()`.
 *
 * These schemas are deliberately permissive: Pi's real config carries many
 * protocol-specific `compat` keys and provider/model fields that vary by
 * version. We validate structure and the fields Pi-Switch edits, and carry
 * everything else through untouched.
 */

import { z } from 'zod'

export const piApiTypeSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai'
])

export const piThinkingLevelSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])

export const piInputTypeSchema = z.enum(['text', 'image'])

export const piModelCostSchema = z.looseObject({
  input: z.number().optional(),
  output: z.number().optional(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional()
})

export const piModelConfigSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().optional(),
  api: z.string().optional(),
  reasoning: z.boolean().optional(),
  thinkingLevelMap: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  input: z.array(piInputTypeSchema).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  samplingParams: z.record(z.string(), z.unknown()).optional(),
  cost: piModelCostSchema.optional(),
  compat: z.record(z.string(), z.unknown()).optional()
})

export const piProviderConfigSchema = z.looseObject({
  baseUrl: z.string().optional(),
  api: z.string().optional(),
  apiKey: z.string().optional(),
  oauth: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  authHeader: z.boolean().optional(),
  compat: z.record(z.string(), z.unknown()).optional(),
  models: z.array(piModelConfigSchema).optional(),
  modelOverrides: z.record(z.string(), piModelConfigSchema.partial()).optional()
})

export const piModelsConfigSchema = z.looseObject({
  providers: z.record(z.string(), piProviderConfigSchema)
})

export const piSettingsConfigSchema = z.looseObject({
  // Pi often materialises unset keys as JSON `null` (not omitted). Accept both.
  defaultProvider: z.string().nullish(),
  defaultModel: z.string().nullish(),
  defaultThinkingLevel: piThinkingLevelSchema.nullish(),
  theme: z.string().nullish(),
  skills: z.array(z.union([z.string(), z.unknown()])).nullish(),
  packages: z.array(z.unknown()).nullish(),
  extensions: z.array(z.string()).nullish(),
  enabledModels: z.array(z.string()).nullish(),
  enableSkillCommands: z.boolean().nullish()
})

export type PiModelsConfigParsed = z.infer<typeof piModelsConfigSchema>
export type PiSettingsConfigParsed = z.infer<typeof piSettingsConfigSchema>
