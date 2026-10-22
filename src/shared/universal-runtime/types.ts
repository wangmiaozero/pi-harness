/**
 * Universal Runtime adapter contract — the kernel seam that decouples
 * Pi-Harness from any single agent engine.
 *
 * `pi` remains the default runtime, but it implements this same contract as
 * any other engine. Adapters must not depend on the Pi SDK. Optional
 * surfaces (list/resume/close/permission responses) are declared via
 * capabilities so weaker runtimes are not forced to fake support.
 */

import type { RuntimeCapabilities } from './capabilities'
import type { RuntimeEvent, RuntimeEventListener, RuntimePromptMessage } from './events'

export interface RuntimeContext {
  /**
   * Isolated per-runtime directory under userData. The adapter owns this
   * directory and must not write outside it (state, caches, logs).
   */
  readonly dataDir: string
  /** Structured logger provided by the kernel; adapters never print to stdout. */
  readonly log: {
    info: (message: string, ...args: unknown[]) => void
    warn: (message: string, ...args: unknown[]) => void
    error: (message: string, ...args: unknown[]) => void
  }
  /** True while the host application is quitting; adapters must drain fast. */
  readonly isQuitting?: () => boolean
}

export type RuntimeInstallState = 'installed' | 'not-installed' | 'unknown'
export type RuntimeHealthStatus = 'ok' | 'unavailable' | 'error'

export interface RuntimeHealth {
  status: RuntimeHealthStatus
  installState: RuntimeInstallState
  /** Detected executable version, when the runtime can be probed. */
  version: string | null
  /** Short user-presentable diagnosis; never secrets or raw stack traces. */
  message: string | null
  checkedAt: number
}

export interface CreateSessionOptions {
  /** Absolute workspace directory the agent will operate in. */
  cwd: string
  /** Initial user message; delivered after the session is created. */
  message?: RuntimePromptMessage
  /** Provider/model hint, when the runtime supports model.selection. */
  model?: { provider?: string; modelId?: string } | null
  /** Native session id to resume, when the runtime supports session.resume. */
  resumeSessionId?: string
  /** MCP server descriptors the runtime should attach, when it supports mcp. */
  mcpServers?: readonly McpServerDescriptor[]
}

export interface McpServerDescriptor {
  name: string
  command?: string
  args?: readonly string[]
  url?: string
  env?: Record<string, string>
}

export interface RuntimeExecution {
  /** Opaque id correlating one prompt with its events and cancellation. */
  executionId: string
}

export interface RuntimeSessionHandle {
  /** Engine-native session id — never composite. */
  sessionId: string
  cwd: string
  /** Native session reference shown to the user (file path, URL, ...). */
  reference?: string
  model?: { provider?: string; modelId?: string } | null
}

export interface RuntimeSessionSummary {
  sessionId: string
  createdAt: number | null
  updatedAt: number | null
  cwd: string | null
  title?: string
  model?: { provider?: string; modelId?: string } | null
}

/**
 * Composite session identity. Pi sessions keep their bare native ids
 * (backwards compatible); every non-pi runtime prefixes its adapter id so
 * sessions from different engines can never collide:
 *   `pi:<sessionId>` is also valid for pi, but bare ids stay pi.
 */
export const COMPOSITE_SESSION_SEPARATOR = ':'

export interface CompositeSessionId {
  runtimeId: string
  nativeSessionId: string
}

export function toCompositeSessionId(runtimeId: string, nativeSessionId: string): string {
  if (runtimeId === 'pi') return nativeSessionId
  return `${runtimeId}${COMPOSITE_SESSION_SEPARATOR}${nativeSessionId}`
}

export function parseCompositeSessionId(sessionId: string): CompositeSessionId {
  const separator = sessionId.indexOf(COMPOSITE_SESSION_SEPARATOR)
  if (separator <= 0) return { runtimeId: 'pi', nativeSessionId: sessionId }
  return {
    runtimeId: sessionId.slice(0, separator),
    nativeSessionId: sessionId.slice(separator + 1)
  }
}

/** Session routing for commands that must never reach the wrong engine. */
export interface AgentRuntimeAdapter {
  readonly id: string
  readonly name: string
  /** Human-presentable short description (i18n keys live in the renderer). */
  readonly description?: string

  getCapabilities(): RuntimeCapabilities

  initialize(context: RuntimeContext): Promise<void>
  healthCheck(): Promise<RuntimeHealth>
  dispose(): Promise<void>

  createSession(options: CreateSessionOptions): Promise<RuntimeSessionHandle>
  sendMessage(sessionId: string, message: RuntimePromptMessage): Promise<RuntimeExecution>
  subscribe(sessionId: string, listener: RuntimeEventListener): () => void

  /** Optional surface — declared via session.list capability. */
  listSessions?(): Promise<RuntimeSessionSummary[]>
  /** Optional surface — declared via session.resume capability. */
  resumeSession?(sessionId: string, options?: { cwd?: string }): Promise<RuntimeSessionHandle>
  /** Optional surface — declared via session.close capability. */
  closeSession?(sessionId: string): Promise<void>
  /** Optional surface — declared via prompt.cancel capability. */
  cancel?(sessionId: string): Promise<void>
  /** Optional surface — declared via permission.requests capability. */
  respondToPermission?(requestId: string, outcome: string): Promise<void>
  /** Optional surface — current running state per session. */
  isRunning?(sessionId: string): boolean
}
