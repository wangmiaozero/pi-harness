/**
 * Pi-Switch Domain Model.
 *
 * Provider ≠ Protocol ≠ Model — these are three decoupled concepts:
 *   - ProviderProfile: a service endpoint + credential bundle.
 *   - Protocol: the API wire format (see Protocol Registry). Stored by id.
 *   - ModelDefinition: a concrete model exposed under a provider.
 *
 * This is Pi-Switch's OWN domain. It is never written verbatim to Pi config;
 * the Pi Config Adapter translates it into Pi's native models.json / settings.json
 * shape, writing ONLY fields Pi understands. Extra domain metadata (enabled,
 * timeout, displayName, capability badges) lives in Pi-Switch's metadata store.
 *
 * Model-agnostic: no field keys off a model name. Unknown providers, model IDs,
 * base URLs and headers are all permitted.
 */

import type { ProtocolId } from '../constants/protocols'
import type { PiThinkingLevel } from '../constants/index'

/** Optional capability metadata. Unknown ≠ unsupported. */
export interface ModelCapabilities {
  text?: boolean
  vision?: boolean
  tools?: boolean
  reasoning?: boolean
  audio?: boolean
  image?: boolean
  streaming?: boolean
}

export type CapabilityKey = keyof ModelCapabilities

/**
 * How an API key is sourced when serialised into Pi config.
 * - literal:  the resolved plaintext is written into models.json (Pi's native field).
 * - env:      a `$ENV` / `${ENV}` reference string is written.
 * - command:  a `!command` (e.g. keychain retrieval) is written.
 * - stored:   key is held in Pi-Switch's secure SecretStore; the serialised form
 *             depends on the platform (keychain command on macOS, literal elsewhere).
 */
export type ApiKeyKind = 'literal' | 'env' | 'command' | 'stored'

export interface ApiKeySpec {
  kind: ApiKeyKind
  /** For literal: the plaintext (held only in main's SecretStore, never in renderer state). */
  literal?: string
  /** For env: the `$VAR`/`${VAR}` reference exactly as written to Pi. */
  envRef?: string
  /** For command: the `!command` string exactly as written to Pi. */
  command?: string
}

export interface ProviderProfile {
  id: string
  /** Stable slug used as the provider key in models.json. */
  key: string
  name: string
  displayName: string
  enabled: boolean
  protocol: ProtocolId
  baseUrl: string
  /** Reference to the SecretStore entry; never holds plaintext in renderer. */
  apiKeyRef: string | null
  /** Source spec used when writing to Pi config. */
  apiKey: ApiKeySpec | null
  headers: Record<string, string>
  authHeader: boolean
  /** Pi-Switch-only metadata; NOT written to Pi config. */
  timeout: number | null
  /** Preferred model id for connection tests / first-run bootstrap. */
  defaultModelId: string | null
  /** Number of models under this provider (denormalised for list views). */
  modelCount: number
  createdAt: number
  updatedAt: number
  [key: string]: unknown
}

export interface ModelDefinition {
  id: string
  providerId: string
  /** The model id passed to the API (required, free-form). */
  modelId: string
  displayName: string
  protocol: ProtocolId
  enabled: boolean
  capabilities: ModelCapabilities
  contextWindow: number | null
  maxOutputTokens: number | null
  reasoning: boolean
  /** UI badge source; derived from capabilities, never from the model name. */
  vision: boolean
  tools: boolean
  streaming: boolean
  thinkingLevels: Partial<Record<PiThinkingLevel, string | null>> | null
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/** What it means to be the "active" model — mirrors Pi settings.json. */
export interface ActiveModel {
  providerKey: string | null
  modelId: string | null
}
