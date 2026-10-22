/**
 * Universal Runtime unified event model.
 *
 * RuntimeEvent is the adapter-level normalization of engine-native events.
 * Adapters map engine events (Pi SDK events, ACP session/update
 * notifications, ...) onto this model; the kernel stamps provenance (source
 * runtime, native session id, sequence, timestamp) and fans events out to
 * subscribers. Engine-native events stay untouched — this model only
 * adapts, it never replaces native streams.
 */

import type { AgentImageAttachment, AssistantContentBlock } from '../types/workspace'

export const RUNTIME_EVENT_TYPES = [
  'runtime.started',
  'runtime.stopped',
  'runtime.error',

  'session.created',
  'session.updated',
  'session.completed',

  'message.started',
  'message.delta',
  'message.thought',
  'message.completed',

  'tool.started',
  'tool.completed',
  'tool.failed',

  'agent.started',
  'agent.completed',
  'agent.failed',

  'permission.requested',
  'permission.responded',

  'execution.cancelled',
  'execution.failed'
] as const

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number]

export interface RuntimeEventProvenance {
  /** Adapter id, e.g. `pi`, `deepseek`, `mock`. */
  runtimeId: string
  /** The engine-native session id (never the composite id). */
  nativeSessionId: string
  /** Monotonic per-(runtime,session) sequence number. */
  sequence: number
  /** Wall-clock timestamp in epoch milliseconds. */
  timestamp: number
  /** Correlated execution id when the event belongs to a prompt. */
  executionId?: string
}

export interface RuntimeMessageDelta {
  delta: string
}

export interface RuntimeMessageContent {
  text?: string
  blocks?: readonly AssistantContentBlock[]
}

export interface RuntimeToolCall {
  toolCallId: string
  toolName: string
  input?: Record<string, unknown>
}

export interface RuntimeToolResult {
  toolCallId: string
  toolName?: string
  isError?: boolean
  content?: RuntimeMessageContent
}

export interface RuntimePermissionRequest {
  requestId: string
  sessionId: string
  title?: string
  kind?: string
  options: readonly { id: string; name: string }[]
}

export interface RuntimeErrorDetail {
  message: string
  kind?: string
  recoverable?: boolean
}

export type RuntimeEvent =
  | { type: 'runtime.started' | 'runtime.stopped'; provenance: RuntimeEventProvenance }
  | { type: 'runtime.error'; provenance: RuntimeEventProvenance; error: RuntimeErrorDetail }
  | {
      type: 'session.created' | 'session.updated' | 'session.completed'
      provenance: RuntimeEventProvenance
      cwd?: string
      model?: { provider?: string; modelId?: string } | null
    }
  | {
      type: 'message.started'
      provenance: RuntimeEventProvenance
      role: 'assistant'
    }
  | {
      type: 'message.delta'
      provenance: RuntimeEventProvenance
      delta: RuntimeMessageDelta
    }
  | {
      type: 'message.thought'
      provenance: RuntimeEventProvenance
      delta: RuntimeMessageDelta
    }
  | {
      type: 'message.completed'
      provenance: RuntimeEventProvenance
      role: 'assistant'
      content: RuntimeMessageContent
      model?: { provider?: string; modelId?: string } | null
      stopReason?: string
    }
  | {
      type: 'tool.started'
      provenance: RuntimeEventProvenance
      toolCall: RuntimeToolCall
    }
  | {
      type: 'tool.completed' | 'tool.failed'
      provenance: RuntimeEventProvenance
      result: RuntimeToolResult
    }
  | { type: 'agent.started'; provenance: RuntimeEventProvenance }
  | {
      type: 'agent.completed'
      provenance: RuntimeEventProvenance
      stopReason?: string
    }
  | { type: 'agent.failed'; provenance: RuntimeEventProvenance; error: RuntimeErrorDetail }
  | {
      type: 'permission.requested'
      provenance: RuntimeEventProvenance
      request: RuntimePermissionRequest
    }
  | {
      type: 'permission.responded'
      provenance: RuntimeEventProvenance
      requestId: string
      outcome: string
    }
  | {
      type: 'execution.cancelled'
      provenance: RuntimeEventProvenance
    }
  | { type: 'execution.failed'; provenance: RuntimeEventProvenance; error: RuntimeErrorDetail }

/** Attachments the universal message format accepts for user prompts. */
export interface RuntimePromptMessage {
  text: string
  images?: readonly AgentImageAttachment[]
}

export type RuntimeEventListener = (event: RuntimeEvent) => void

export function isRuntimeEventType(type: string): type is RuntimeEventType {
  return (RUNTIME_EVENT_TYPES as readonly string[]).includes(type)
}
