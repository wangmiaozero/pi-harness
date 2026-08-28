import type {
  AgentEvent,
  AgentStateSnapshot,
  StartAgentSessionInput
} from '@shared/types/workspace'
import type {
  HarnessCapabilities,
  HarnessCompactionResult,
  HarnessEvent,
  HarnessForkResult,
  HarnessSessionInfo,
  HarnessState,
  HarnessStats,
  HarnessTool
} from '@shared/types/harness'

export interface HarnessPromptOptions {
  images?: unknown
  streamingBehavior?: 'steer' | 'followUp'
}

export interface HarnessSessionStartResult {
  sessionId: string
  cwd: string
}

export interface HarnessAdapter {
  diagnostics(): { implementation: 'pi'; sdkLoaded: boolean }
  listRunning(): string[]
  startSession(input: StartAgentSessionInput): Promise<HarnessSessionStartResult>
  stopSession(sessionId: string): Promise<void>
  prompt(sessionId: string, message: string, options?: HarnessPromptOptions): Promise<unknown>
  abort(sessionId: string): Promise<void>
  steer(sessionId: string, message: string, images?: unknown): Promise<void>
  followUp(sessionId: string, message: string, images?: unknown): Promise<void>
  getAgentState(sessionId: string): Promise<AgentStateSnapshot | null>
  getState(sessionId: string): Promise<HarnessState | null>
  getCapabilities(sessionId: string): Promise<HarnessCapabilities>
  getTools(sessionId: string): Promise<HarnessTool[]>
  setTools(
    sessionId: string,
    toolNames: string[],
    options?: { preserveExtensionTools?: boolean }
  ): Promise<void>
  setModel(sessionId: string, provider: string, modelId: string): Promise<void>
  setThinkingLevel(sessionId: string, level: string): Promise<void>
  compact(sessionId: string, instructions?: string): Promise<HarnessCompactionResult | unknown>
  abortCompaction(sessionId: string): Promise<void>
  setAutoCompaction(sessionId: string, enabled: boolean): Promise<void>
  fork(sessionId: string, entryId: string): Promise<HarnessForkResult>
  navigateTree(sessionId: string, targetId: string): Promise<unknown>
  getStats(sessionId: string): Promise<HarnessStats>
  getSession(sessionId: string): Promise<HarnessSessionInfo>
  subscribe(sessionId: string, listener: (event: HarnessEvent) => void): () => void
  executeAgentCommand(sessionId: string, command: Record<string, unknown>): Promise<unknown>
  defaultToolNames(): string[]
  shutdownAll(): Promise<void>
}

export type PiAgentEventListener = (sessionId: string, event: AgentEvent) => void
