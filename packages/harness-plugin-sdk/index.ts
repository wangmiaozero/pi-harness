/** Standalone contract: no Pi SDK, Electron or private application imports. */
export const HARNESS_PLUGIN_API_VERSION = '1.0.0'
export const PLUGIN_EVENT_TYPES = [
  'run.started',
  'run.completed',
  'run.failed',
  'tool.completed',
  'evaluation.completed'
] as const
export type PluginEventType = (typeof PLUGIN_EVENT_TYPES)[number]
export type PluginPermission = 'events:read' | 'evaluation:read' | 'trace:read' | 'teams:contribute'
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export interface Contribution {
  id: string
  version: string
}
export interface TeamTemplate extends Contribution {
  name: string
  permissions: PluginPermission[]
  agents: Array<{
    key: string
    name: string
    role: string
    description?: string
    workspaceMode: 'shared' | 'worktree'
    isReviewer: boolean
  }>
  tasks: Array<{
    key: string
    title: string
    description: string
    agent: string
    dependencies: string[]
    reviewRequired: boolean
  }>
}
export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: string
  description: string
  author: string
  /** null means data only. Code is never executed during discovery or installation. */
  entry: string | null
  permissions: PluginPermission[]
  contributions: {
    events: PluginEventType[]
    evaluators: Contribution[]
    exporters: Contribution[]
    teams: TeamTemplate[]
  }
}
export interface PluginEvent {
  sessionId: string
  event: {
    type: PluginEventType
    timestamp: number
    runId?: string
    status?: string
    toolName?: string
    isError?: boolean
  }
}
export interface RunEvidence {
  runId: string
  status: string
  startedAt: number
  finishedAt: number | null
  toolCallCount: number
  toolFailureCount: number
  totalTokens: number
}
export interface AuthorizedTrace {
  runId: string
  source: 'recorded' | 'reconstructed'
  spans: Array<{
    id: string
    type: string
    status: string
    startedAt: number
    duration: number | null
  }>
}
export interface EvaluatorResult {
  evaluatorId: string
  version: string
  score: number
  status: 'passed' | 'warning' | 'failed'
  findings: Array<{ code: string; severity: 'info' | 'warning' | 'error'; message: string }>
  metadata: { [key: string]: JsonValue }
}
export interface PluginContext {
  readonly apiVersion: string
  events: {
    subscribe(
      types: readonly PluginEventType[],
      listener: (event: Readonly<PluginEvent>) => void | Promise<void>
    ): () => void
  }
  evaluators: {
    register(
      definition: Contribution,
      evaluate: (evidence: Readonly<RunEvidence>) => EvaluatorResult | Promise<EvaluatorResult>
    ): () => void
  }
  exporters: {
    register(
      definition: Contribution,
      exportTrace: (trace: Readonly<AuthorizedTrace>) => JsonValue | Promise<JsonValue>
    ): () => void
  }
  diagnostics: { log(message: string, metadata?: { [key: string]: JsonValue }): void }
}
export interface HarnessPlugin {
  activate(context: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
export function definePlugin(plugin: HarnessPlugin): HarnessPlugin {
  return plugin
}
