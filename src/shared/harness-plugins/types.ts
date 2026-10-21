import type {
  PluginManifest,
  PluginPermission,
  EvaluatorResult
} from '../../../packages/harness-plugin-sdk'
export type { PluginManifest, PluginPermission, EvaluatorResult }
export type PluginStatus =
  'installed' | 'disabled' | 'activating' | 'active' | 'failed' | 'incompatible'
export interface PluginDiagnostic {
  at: number
  level: 'info' | 'warning' | 'error'
  code: string
  message: string
}
export interface PluginRecord {
  manifest: PluginManifest
  digest: string
  enabled: boolean
  grants: PluginPermission[]
  trustedDigest: string | null
  installedAt: number
}
export interface PluginDescriptor extends PluginRecord {
  status: PluginStatus
  compatible: boolean
  diagnostics: PluginDiagnostic[]
  droppedEvents: number
  results: Array<{ runId: string; result: EvaluatorResult }>
}
export interface HarnessPluginsAPI {
  list(): Promise<PluginDescriptor[]>
  installLocal(): Promise<PluginDescriptor | null>
  setEnabled(id: string, enabled: boolean): Promise<void>
  uninstall(id: string): Promise<void>
  evaluate(
    id: string,
    contributionId: string,
    sessionId: string,
    runId: string
  ): Promise<EvaluatorResult>
  exportTrace(
    id: string,
    contributionId: string,
    sessionId: string,
    runId: string
  ): Promise<boolean>
  applyTeam(id: string, contributionId: string): Promise<string | null>
}
