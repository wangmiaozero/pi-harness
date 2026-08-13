/**
 * Pi-Switch metadata — domain fields that must NOT be written into Pi config
 * (enabled flags, display names, timeouts, capability badges, etc.).
 */

import { appMetadataPath } from './app-paths'
import { JsonStore } from './storage'

export interface ProviderMeta {
  displayName?: string
  enabled?: boolean
  timeout?: number | null
  apiKeyRef?: string | null
  /** Preferred model id used for connection tests and bootstrap. */
  defaultModelId?: string | null
  createdAt?: number
  updatedAt?: number
}

export interface ModelMeta {
  displayName?: string
  enabled?: boolean
  capabilities?: {
    text?: boolean
    vision?: boolean
    tools?: boolean
    reasoning?: boolean
    streaming?: boolean
  }
  createdAt?: number
  updatedAt?: number
}

export interface AppMetadata {
  providers: Record<string, ProviderMeta>
  /** key: `${providerKey}::${modelId}` */
  models: Record<string, ModelMeta>
}

const DEFAULTS: AppMetadata = {
  providers: {},
  models: {}
}

export function modelMetaKey(providerKey: string, modelId: string): string {
  return `${providerKey}::${modelId}`
}

export function createMetadataStore(): JsonStore<AppMetadata> {
  return new JsonStore(appMetadataPath(), DEFAULTS)
}
