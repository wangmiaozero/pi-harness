/**
 * Pi-Harness Agent Runtime boundary.
 *
 * Main application services and IPC depend on this interface, never on Pi SDK
 * types. PiAgentRuntime is the only implementation; adding another runtime is
 * intentionally out of scope.
 */

import type { AgentStateSnapshot, StartAgentSessionInput, ToolEntry } from '@shared/types/workspace'

export interface AgentRuntime {
  diagnostics(): { implementation: 'pi'; sdkLoaded: boolean }
  listRunning(): string[]
  getState(sessionId: string): Promise<AgentStateSnapshot | null>
  start(input: StartAgentSessionInput): Promise<{ sessionId: string; cwd: string }>
  prompt(
    sessionId: string,
    message: string,
    extras?: { images?: unknown; streamingBehavior?: 'steer' | 'followUp' }
  ): Promise<unknown>
  abort(sessionId: string): Promise<void>
  /** Dispose a live runtime wrapper without changing the persisted session. */
  stop(sessionId: string): Promise<void>
  command(sessionId: string, command: Record<string, unknown>): Promise<unknown>
  getTools(sessionId: string): Promise<ToolEntry[]>
  defaultToolNames(): string[]
  shutdownAll(): Promise<void>
}
