/**
 * Lazy loader for @earendil-works/pi-coding-agent.
 * AgentSession lives only in Main. Renderer never imports this module.
 */

export interface PiSessionManagerLike {
  getCwd(): string
  getSessionFile(): string | null | undefined
  getSessionId(): string
  getSessionName(): string | undefined
  getEntries(): unknown[]
  getEntry(id: string): unknown
  getHeader(): { id?: string; cwd?: string; timestamp?: string; parentSession?: string } | null
  getLeafId(): string | null
  getBranch(): unknown[]
  getSessionDir(): string
  isPersisted(): boolean
  newSession(options?: { parentSession?: string }): void
  createBranchedSession(entryId: string): string | null
  appendSessionInfo?(name: string): void
}

export interface PiSessionInfoLike {
  path: string
  id: string
  cwd: string
  name?: string
  created: Date | string
  modified: Date | string
  messageCount: number
  firstMessage?: string
  parentSessionPath?: string
}

export interface PiCodingAgentModule {
  SessionManager: {
    listAll: () => Promise<PiSessionInfoLike[]>
    open: (file: string, dir?: string) => PiSessionManagerLike
    create: (cwd: string, dir?: string) => PiSessionManagerLike
  }
  getAgentDir?: () => string
  SettingsManager?: { create: (cwd: string, agentDir: string) => unknown }
  createAgentSessionServices?: (options: Record<string, unknown>) => Promise<{
    modelRuntime: PiModelRuntimeLike
    [key: string]: unknown
  }>
  createAgentSessionFromServices?: (options: Record<string, unknown>) => Promise<{
    session: AgentSessionLike
  }>
  initTheme?: () => void
  resolveModelScopeWithDiagnostics?: (
    runtime: unknown,
    patterns: string[]
  ) => Promise<{
    models?: unknown[]
    scopedModels?: unknown[]
    warnings?: string[]
  }>
  buildSessionContext?: (
    entries: unknown[],
    leafId: string | null | undefined,
    byId: Map<string, unknown>
  ) => { thinkingLevel?: string; model?: { provider: string; modelId: string } | null }
  buildContextEntries?: (
    entries: unknown[],
    leafId: string | null | undefined,
    byId: Map<string, unknown>
  ) => unknown[]
}

export interface PiModelRuntimeLike {
  getModel: (provider: string, modelId: string) => unknown
  refresh: (options?: { allowNetwork?: boolean }) => Promise<unknown>
  completeSimple: (
    model: unknown,
    context: {
      systemPrompt?: string
      messages: Array<{ role: 'user'; content: string; timestamp: number }>
    },
    options?: {
      maxTokens?: number
      temperature?: number
      timeoutMs?: number
      maxRetries?: number
    }
  ) => Promise<{
    content: Array<{ type: string; text?: string }>
    stopReason?: string
    errorMessage?: string
  }>
}

export interface AgentSessionLike {
  sessionId: string
  sessionFile?: string | null
  sessionManager: PiSessionManagerLike
  isStreaming: boolean
  isBashRunning: boolean
  isCompacting: boolean
  autoCompactionEnabled: boolean
  autoRetryEnabled?: boolean
  pendingMessageCount?: number
  model: { id: string; provider: string; compat?: { thinkingFormat?: string } } | null
  thinkingLevel?: string
  agent: { state?: { systemPrompt?: string; thinkingLevel?: string; streamingMessage?: unknown } }
  modelRuntime: {
    getModel: PiModelRuntimeLike['getModel']
    refresh: (options?: { allowNetwork?: boolean }) => Promise<void>
    completeSimple?: PiModelRuntimeLike['completeSimple']
  }
  settingsManager?: { getShellPath?: () => string }
  extensionRunner?: {
    getRegisteredCommands?: () => Array<{
      invocationName: string
      description?: string
      sourceInfo?: unknown
    }>
    setUIContext?: (ctx: unknown, mode?: string) => void
  }
  promptTemplates?: Array<{ name: string; description?: string; sourceInfo?: unknown }>
  resourceLoader?: {
    getSkills?: () => {
      skills: Array<{ name: string; description?: string; sourceInfo?: unknown }>
    }
  }
  subscribe: (listener: (event: { type: string; [key: string]: unknown }) => void) => () => void
  prompt: (message: string, options?: Record<string, unknown>) => Promise<void>
  abort: () => Promise<void> | void
  abortCompaction?: () => void
  abortBash?: () => void
  compact: (instructions?: string) => Promise<unknown>
  navigateTree: (
    targetId: string,
    options?: Record<string, unknown>
  ) => Promise<{ cancelled: boolean }>
  setModel: (model: unknown) => Promise<void>
  setThinkingLevel: (level: string) => void
  getAvailableThinkingLevels?: () => string[]
  setSessionName: (name: string) => void
  setAutoCompactionEnabled: (enabled: boolean) => void
  setAutoRetryEnabled?: (enabled: boolean) => void
  setActiveToolsByName: (names: string[]) => void
  getAllTools: () => Array<{ name: string; description: string }>
  getActiveToolNames: () => string[]
  getContextUsage?: () => {
    percent: number | null
    contextWindow: number
    tokens: number | null
  } | null
  getSessionStats?: () => Record<string, unknown>
  getLastAssistantText?: () => string | null
  getSteeringMessages?: () => string[]
  getFollowUpMessages?: () => string[]
  steer?: (message: string, images?: unknown) => Promise<void>
  followUp?: (message: string, images?: unknown) => Promise<void>
  executeBash?: (command: string, a?: unknown, b?: unknown) => Promise<unknown>
  reload?: () => Promise<void>
  bindExtensions?: (bindings: Record<string, unknown>) => Promise<void>
  dispose: () => void
  supportsThinking?: () => boolean
}

let cached: PiCodingAgentModule | null | undefined

export async function loadPiCodingAgent(): Promise<PiCodingAgentModule> {
  if (cached) return cached
  try {
    cached = (await import('@earendil-works/pi-coding-agent')) as unknown as PiCodingAgentModule
    return cached
  } catch (error) {
    cached = null
    throw error
  }
}

export function peekPiCodingAgent(): PiCodingAgentModule | null {
  return cached ?? null
}
