// @ts-nocheck
/**
 * Pi-Harness metadata — domain fields that must NOT be written into Pi config
 * (enabled flags, display names, timeouts, capability badges, etc.).
 */

import { appMetadataPath } from './app-paths.js'
import { JsonStore } from './storage.js'
import type { CapabilityMetadata } from '../../vendor/shared/capabilities/types.js'
import type { BuiltinSkillCategory, PiPackageScope } from '../../vendor/shared/ipc/api-types.js'

export interface ProviderMeta {
  /** Pi-Harness internal provider name; Pi models.json has no equivalent field. */
  name?: string
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

export interface BuiltinSkillOwnership {
  collectionId: string
  skillId: string
  category: BuiltinSkillCategory
  scope: PiPackageScope
  projectRoot: string | null
  installedPath: string
  sourcePath: string
  installedAt: string
  sourceCommit: string
  sourceHash: string
}

export interface BuiltinSkillOwnershipManifest {
  schemaVersion: 1
  installed: Record<string, BuiltinSkillOwnership>
}

export interface AppMetadata {
  providers: Record<string, ProviderMeta>
  /** key: `${providerKey}::${modelId}` */
  models: Record<string, ModelMeta>
  /** Pi-Harness-only capability state. Never written into Pi native settings. */
  capabilities: Record<string, CapabilityMetadata>
  /** Ownership only; Pi still discovers installed standalone Skills from the filesystem. */
  builtinSkills: BuiltinSkillOwnershipManifest
}

const DEFAULTS: AppMetadata = {
  providers: {},
  models: {},
  capabilities: {},
  builtinSkills: { schemaVersion: 1, installed: {} }
}

export function modelMetaKey(providerKey: string, modelId: string): string {
  return `${providerKey}::${modelId}`
}

export function createMetadataStore(): JsonStore<AppMetadata> {
  return new JsonStore(appMetadataPath(), DEFAULTS)
}
