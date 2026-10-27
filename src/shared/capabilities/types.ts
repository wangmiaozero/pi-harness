import type { AppErrorCode } from '../types/errors'

export const CAPABILITY_TYPES = ['skill', 'extension', 'package', 'mcp', 'preset'] as const

export type CapabilityType = (typeof CAPABILITY_TYPES)[number]

export const CAPABILITY_SOURCES = ['local', 'github', 'npm', 'marketplace', 'builtin'] as const

export type CapabilitySource = (typeof CAPABILITY_SOURCES)[number]

export const CAPABILITY_CATEGORIES = [
  'native',
  'development-methodology',
  'governance-methodology',
  'spec-driven-development',
  'agent-workflow'
] as const

export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number]

export const CAPABILITY_INTEGRATIONS = ['native-pi', 'pi-package', 'pi-skill'] as const

export type CapabilityIntegration = (typeof CAPABILITY_INTEGRATIONS)[number]

export interface CapabilityFeatureFlags {
  brainstorming?: boolean
  planning?: boolean
  tdd?: boolean
  codeReview?: boolean
  debugging?: boolean
  systematicDebugging?: boolean
  worktrees?: boolean
  subagentWorkflow?: boolean
  parallelAgentWorkflow?: boolean
  verification?: boolean
  browser?: boolean
  filesystem?: boolean
  git?: boolean
  terminal?: boolean
  search?: boolean
}

export type CapabilityInstallDefinition =
  | {
      strategy: 'skills-cli'
      /** Name passed to the trusted installer as `--skill <selector>`. */
      selector: string
      target: 'pi-global'
    }
  | {
      strategy: 'pi-package'
      /** Exact trusted source passed to `pi install` / `pi update` / `pi remove`. */
      source: string
      target: 'pi-global'
    }

export interface CapabilityDefinition {
  id: string
  type: CapabilityType
  name: string
  description?: string
  version?: string
  source: CapabilitySource
  sourceUrl?: string
  builtin?: boolean
  featured?: boolean
  recommended?: boolean
  optional?: boolean
  category?: CapabilityCategory
  integration?: CapabilityIntegration
  /** Stable catalog ordering; lower values are shown first. */
  order?: number
  tags?: string[]
  useCases?: string[]
  capabilities?: CapabilityFeatureFlags
  install?: CapabilityInstallDefinition
  /** Presets reference other capability ids; they do not create a second runtime. */
  members?: string[]
  /** Declared functional areas with honest support status; rendered in the UI. */
  modules?: CapabilityModule[]
  metadata?: Record<string, unknown>
}

export type CapabilityStatus =
  | 'not-installed'
  | 'installed'
  | 'disabled'
  | 'installing'
  | 'updating'
  | 'uninstalling'
  | 'failed'
  | 'update-available'

export type CapabilityHealth = 'not-installed' | 'healthy' | 'warning' | 'error' | 'unknown'

export interface CapabilityOwnership {
  managedBy: 'pi-harness' | 'pi-package' | 'external'
  scope: 'global' | 'project' | 'unknown'
  readOnly: boolean
}

export interface CapabilityDescriptor extends CapabilityDefinition {
  installed: boolean
  enabled: boolean
  health: CapabilityHealth
  ownership?: CapabilityOwnership
  installPath: string | null
  installedVersion: string | null
  lastModified: number | null
  updateAvailable: boolean
  status: CapabilityStatus
  readOnly?: boolean
  lastErrorCode?: AppErrorCode | null
  lastErrorAt?: number | null
  lastErrorAction?: CapabilityMutationAction | null
}

export type CapabilityMutationAction = 'install' | 'update' | 'uninstall' | 'enable' | 'disable'

export const CAPABILITY_MODULE_STATUSES = ['supported', 'partial', 'unsupported'] as const

export type CapabilityModuleStatus = (typeof CAPABILITY_MODULE_STATUSES)[number]

/**
 * Declared, honestly-labeled functional area of a capability pack. The status
 * must reflect verified reality: `unsupported` marks functionality whose
 * adaptation has not been integrated into Pi-Harness yet; it must never be
 * rendered as a working toggle.
 */
export interface CapabilityModule {
  id: string
  status: CapabilityModuleStatus
}

export type CapabilityMutationPhase =
  | 'idle'
  | 'resolving'
  | 'installing'
  | 'updating'
  | 'uninstalling'
  | 'validating'
  | 'success'
  | 'failed'

export interface CapabilityMutationProgress {
  skillId: string
  action: CapabilityMutationAction
  phase: CapabilityMutationPhase
  message?: string
  stderr?: string
  exitCode?: number | null
}

export interface CapabilityActionResult {
  capability: CapabilityDescriptor
  action: CapabilityMutationAction
  phase: 'success'
  durationMs: number
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Pi-Harness-only snapshot of the exact Pi registry entry captured when a
 * package capability is disabled. Restored verbatim on re-enable so unknown
 * Pi-native fields (resource filters, pinned versions) are never lost.
 */
export interface CapabilityMetadata {
  enabled?: boolean
  favorite?: boolean
  installSource?: CapabilitySource
  sourceUrl?: string
  installPath?: string
  lastCheckedAt?: number
  lastUpdatedAt?: number
  category?: string
  tags?: string[]
  packageRegistryEntry?: unknown
  lastErrorCode?: AppErrorCode | null
  lastErrorAt?: number | null
  lastErrorAction?: CapabilityMutationAction | null
}
