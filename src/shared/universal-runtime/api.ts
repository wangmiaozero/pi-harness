/**
 * Renderer-facing API contract for the Universal Runtime surface. Main, the
 * preload bridge and the renderer share these DTO types.
 */

import type { RuntimeCapabilities, RuntimeEvent, RuntimeHealth } from '.'

/** Read-only runtime descriptor pushed to / pulled from the renderer. */
export interface UniversalRuntimeDescriptor {
  id: string
  name: string
  description?: string
  enabled: boolean
  builtin: boolean
  capabilities: RuntimeCapabilities
  health: RuntimeHealth | null
  initialized: boolean
}

/** A live multi-runtime session tracked during this app run. */
export interface UniversalSessionRecord {
  compositeId: string
  runtimeId: string
  nativeSessionId: string
  cwd: string
  model: { provider?: string; modelId?: string } | null
  createdAt: number
  updatedAt: number
  running: boolean
  resumed: boolean
}

/** Session-center list item across runtimes (live + persisted). */
export interface UniversalSessionListItem {
  compositeId: string
  runtimeId: string
  nativeSessionId: string
  cwd: string | null
  title?: string
  model: { provider?: string; modelId?: string } | null
  createdAt: number | null
  updatedAt: number | null
  running?: boolean
  live: boolean
}

export interface UniversalRuntimesAPI {
  list(): Promise<UniversalRuntimeDescriptor[]>
  health(): Promise<UniversalRuntimeDescriptor[]>
  setEnabled(runtimeId: string, enabled: boolean): Promise<UniversalRuntimeDescriptor[]>
  listSessions(filter?: { runtimeId?: string }): Promise<UniversalSessionListItem[]>
  createSession(input: {
    runtimeId: string
    cwd: string
    message?: string
    model?: { provider?: string; modelId?: string } | null
    resumeSessionId?: string
  }): Promise<UniversalSessionRecord>
  prompt(sessionId: string, message: string): Promise<{ executionId: string }>
  cancel(sessionId: string): Promise<void>
  close(sessionId: string): Promise<void>
  respondPermission(requestId: string, outcome: string): Promise<void>
}

export interface UniversalRuntimesChangedPayload {
  at: number
  runtimes: UniversalRuntimeDescriptor[]
}
