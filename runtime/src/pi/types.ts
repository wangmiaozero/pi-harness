/**
 * Structural types for the parts of `@earendil-works/pi-coding-agent` the
 * runtime touches.
 *
 * The runtime never imports the SDK statically; it lazy-loads it and treats
 * the module through these structural shapes (same approach as the Electron
 * main's `src/main/agent/pi-sdk.ts`). This pins the exact surface we depend on
 * and keeps the runtime compilable without the SDK being resolvable.
 */

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

export interface PiModelRuntimeLike {
  getModel: (provider: string, modelId: string) => PiModelLike | undefined
  refresh: (options?: { allowNetwork?: boolean }) => Promise<unknown>
}

export interface PiModelLike {
  id: string
  provider: string
  input?: Array<'text' | 'image'>
  compat?: { thinkingFormat?: string }
  thinkingLevelMap?: Partial<Record<string, string | null>>
}

export interface PiAgentStateLike {
  systemPrompt?: string
  thinkingLevel?: string
}

/** Minimal AgentSession surface used by the runtime agent wrapper. */
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
  model: PiModelLike | null
  thinkingLevel?: string
  agent: { state?: PiAgentStateLike }
  modelRuntime: Pick<PiModelRuntimeLike, 'getModel'> & {
    refresh: (options?: { allowNetwork?: boolean }) => Promise<void>
  }
  settingsManager?: { getBlockImages?: () => boolean }
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
  setModel: (model: PiModelLike) => Promise<void>
  setThinkingLevel: (level: string) => void
  getAvailableThinkingLevels?: () => string[]
  setSessionName: (name: string) => void
  setAutoCompactionEnabled: (enabled: boolean) => void
  setActiveToolsByName: (names: string[]) => void
  getAllTools: () => Array<{ name: string; description: string }>
  getActiveToolNames: () => string[]
  getContextUsage?: () => {
    percent: number | null
    contextWindow: number
    tokens: number | null
  } | null
  getSessionStats?: () => Record<string, unknown>
  supportsThinking?: () => boolean
  steer?: (message: string, images?: unknown) => Promise<void>
  followUp?: (message: string, images?: unknown) => Promise<void>
  exportToHtml?: (options?: Record<string, unknown>) => string
  exportToJsonl?: () => string
  /**
   * Steering / follow-up mode (Pi SDK >= 0.84). One must be set before any
   * streaming prompt, otherwise `prompt()` throws.
   */
  setSteeringMode?: (enabled: boolean) => void
  setFollowUpMode?: (enabled: boolean) => void
  hasActiveModelApiKey?: () => boolean
}

/** `AgentSessionEvent` union (structural). All fields beyond `type` optional. */
export interface PiAgentSessionEventLike {
  type: string
  [key: string]: unknown
}

export interface PiAgentSessionDiagnosticLike {
  type: 'info' | 'warning' | 'error'
  message: string
}

export interface PiCreateAgentSessionServicesOptions {
  cwd: string
  agentDir?: string
  modelRuntime?: PiModelRuntimeLike
  modelRuntimeSignal?: { aborted: boolean }
  extensionFlagValues?: Record<string, unknown>
}

export interface PiCreateAgentSessionResultLike {
  session: AgentSessionLike
  diagnostics: PiAgentSessionDiagnosticLike[]
}

export interface PiSettingsManagerLike {
  getBlockImages?: () => boolean
}

/** Structural shape of the `@earendil-works/pi-coding-agent` module. */
export interface PiCodingAgentModuleLike {
  VERSION: string
  SessionManager: {
    create(cwd: string, sessionDir?: string): PiSessionManagerLike
    open(path: string, sessionDir?: string, cwdOverride?: string): PiSessionManagerLike
    listAll(sessionDir?: string): Promise<PiSessionInfoLike[]>
  }
  createAgentSessionServices: (options: PiCreateAgentSessionServicesOptions) => Promise<{
    settingsManager: PiSettingsManagerLike
    modelRuntime: PiModelRuntimeLike
    extensionRuntime?: unknown
    [key: string]: unknown
  }>
  createAgentSessionFromServices: (options: {
    services: Record<string, unknown>
    sessionManager: PiSessionManagerLike
    registerLoggers?: (logger: { error: (message: string) => void }) => void
    [key: string]: unknown
  }) => Promise<PiCreateAgentSessionResultLike>
  buildContextEntries: (
    entries: unknown[],
    leafId?: string | null,
    byId?: Map<string, unknown>
  ) => unknown[]
  buildSessionContext: (
    entries: unknown[],
    leafId?: string | null,
    byId?: Map<string, unknown>
  ) => { thinkingLevel?: string; model?: { provider?: string; modelId?: string } | null }
  sessionEntryToContextMessages?: (entry: unknown) => unknown[]
  getAgentDir: () => string
  initTheme?: () => void
}

/** Factory producing a loaded SDK module (real loader or a test double). */
export type PiSdkLoader = () => Promise<PiCodingAgentModuleLike>
