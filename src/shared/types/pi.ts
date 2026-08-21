/**
 * Pi Coding Agent native configuration types.
 *
 * Derived from the real Pi 0.84.1 configuration files
 * (~/.pi/agent/settings.json, ~/.pi/agent/models.json) and the official
 * docs (providers.md, models.md, settings.md, skills.md). These describe
 * the ON-DISK format Pi expects — NOT Pi-Harness's domain model.
 */

import type { PiThinkingLevel, PiInputType } from '../constants/index'

/** Protocol values Pi's `api` field accepts (matches the Protocol Registry). */
export type PiApiType =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | (string & {})

/**
 * A model entry inside a provider's `models` array.
 * Only `id` is required; all other fields are optional.
 */
export interface PiModelConfig {
  id: string
  name?: string
  api?: PiApiType
  reasoning?: boolean
  thinkingLevelMap?: Partial<Record<PiThinkingLevel, string | null>>
  input?: PiInputType[]
  contextWindow?: number
  maxTokens?: number
  samplingParams?: Record<string, unknown>
  cost?: PiModelCost
  /** Provider compatibility overrides; merged with provider-level compat. */
  compat?: Record<string, unknown>
  /** Unknown fields preserved on round-trip (kept by loose parsing). */
  [key: string]: unknown
}

export interface PiModelCost {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  tiers?: unknown
  [key: string]: unknown
}

/**
 * A provider entry in models.json `providers`. `baseUrl` and `api` are needed
 * for providers that declare `models`; built-in providers can be overridden
 * with only a `baseUrl`.
 */
export interface PiProviderConfig {
  baseUrl?: string
  api?: PiApiType
  /** Literal, `$ENV`/`${ENV}`, or `!command` resolved by Pi at request time. */
  apiKey?: string
  oauth?: string
  headers?: Record<string, string>
  authHeader?: boolean
  compat?: Record<string, unknown>
  models?: PiModelConfig[]
  modelOverrides?: Record<string, Partial<PiModelConfig>>
  /** Unknown fields preserved on round-trip. */
  [key: string]: unknown
}

/** Root of ~/.pi/agent/models.json. */
export interface PiModelsConfig {
  providers: Record<string, PiProviderConfig>
  /** Unknown top-level fields preserved on round-trip. */
  [key: string]: unknown
}

/**
 * Root of ~/.pi/agent/settings.json. Pi uses a free-form JSON object; these
 * are the known fields Pi-Harness cares about. Everything else is preserved.
 */
export interface PiSettingsConfig {
  defaultProvider?: string | null
  defaultModel?: string | null
  defaultThinkingLevel?: PiThinkingLevel | null
  theme?: string | null
  skills?: (string | { source: string; skills?: string[]; extensions?: string[] })[] | null
  packages?: unknown[] | null
  extensions?: string[] | null
  enabledModels?: string[] | null
  enableSkillCommands?: boolean | null
  [key: string]: unknown
}
