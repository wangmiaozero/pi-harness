/**
 * JSONL RPC protocol messages.
 *
 * Contract (protocol version 1):
 *
 * Host -> runtime (stdin), one JSON object per line:
 *   { "id": "req_001", "method": "runtime.ping", "params": { ... } }
 *
 * Runtime -> host (stdout), one JSON object per line:
 *   success: { "id": "req_001", "result": { ... } }
 *   failure: { "id": "req_001", "error": { "code": "...", "message": "..." } }
 *   event:   { "type": "event", "event": "runtime.ready", "payload": { ... },
 *              "sequence": 42, "timestamp": 1730000000000 }
 *
 * Rules:
 * - `id` is a non-empty string; the host correlates responses by `id`.
 * - A request MUST be answered exactly once, success or failure.
 * - Events are unsolicited and carry no `id`. Since protocol version 1.1
 *   every event envelope also carries a monotonic `sequence` (1-based, per
 *   process) and an epoch-ms `timestamp`; older hosts ignore them.
 * - stdout is protocol-only. Human-readable logs go to stderr.
 * - Unknown top-level keys are ignored (forward compatibility).
 */

export const RPC_ERROR_CODES = [
  // Protocol level
  'INVALID_REQUEST',
  'METHOD_NOT_FOUND',
  'INTERNAL_ERROR',
  'HARNESS_ERROR',
  'SHUTDOWN',
  'RUNTIME_PROTOCOL_MISMATCH',
  // Runtime / SDK lifecycle
  'PI_SDK_LOAD_FAILED',
  'PI_NOT_FOUND',
  'PI_SDK_NOT_AVAILABLE',
  // Sessions
  'SESSION_NOT_FOUND',
  'SESSION_NOT_RUNNING',
  // Agent
  'AGENT_NOT_FOUND',
  'AGENT_BUSY',
  'AGENT_ERROR',
  'MODEL_NOT_FOUND',
  'TOOL_NOT_FOUND',
  'INVALID_INPUT',
  // Harness
  'COMPACTION_NOT_AVAILABLE',
  'COMPACTION_FAILED',
  'CAPABILITY_NOT_SUPPORTED',
  // Harness control plane (Phase 3 — mirrors HarnessErrorCode in harness-control/types.ts)
  'AGENT_RUNNING',
  'BASH_RUNNING',
  'POLICY_DENIED',
  'BUDGET_EXCEEDED',
  'CHECKPOINT_NOT_FOUND',
  'RUN_NOT_FOUND',
  'FORK_FAILED',
  'EXPORT_FAILED',
  'ORCHESTRATION_NOT_FOUND',
  'TASK_NOT_FOUND',
  'TEMPLATE_NOT_FOUND',
  'TEAM_NOT_FOUND',
  'DEPENDENCY_CYCLE',
  'ORCHESTRATION_NOT_RUNNING',
  'ORCHESTRATION_BUSY',
  'HANDOFF_NOT_FOUND',
  'INVALID_STATE'
] as const

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number]

export interface RpcRequest {
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface RpcErrorPayload {
  /** Protocol codes plus AppErrorCode values from ported desktop services. */
  code: string
  message: string
  /** Sanitized, user-facing phrasing (mirrors `AppErrorPayload.userMessage`). */
  userMessage?: string
  /** Optional structured diagnostic context (must be JSON-serialisable). */
  data?: unknown
}

export type RpcResult = { ok: true; result: unknown } | { ok: false; error: RpcErrorPayload }

export interface RpcEventEnvelope {
  type: 'event'
  event: string
  payload?: unknown
  /** Monotonic 1-based counter over all events emitted by this process. */
  sequence?: number
  /** Epoch milliseconds. */
  timestamp?: number
  /** Sidecar generation stamped by the desktop host (`runtime-001`). */
  generationId?: string
}

/** A response line: either carries `result` or `error`, never both. */
export type RpcResponseLine =
  { id: string; result: unknown } | { id: string; error: RpcErrorPayload }

export type RuntimeMessage = RpcResponseLine | RpcEventEnvelope

const ID_MAX_LENGTH = 128
const METHOD_MAX_LENGTH = 128

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= ID_MAX_LENGTH
}

export function isValidMethodName(method: unknown): method is string {
  return (
    typeof method === 'string' &&
    method.length > 0 &&
    method.length <= METHOD_MAX_LENGTH &&
    /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9_-]+)+$/.test(method)
  )
}

export function isRpcErrorPayload(value: unknown): value is RpcErrorPayload {
  return (
    isPlainObject(value) &&
    typeof value['code'] === 'string' &&
    (RPC_ERROR_CODES as readonly string[]).includes(value['code']) &&
    typeof value['message'] === 'string'
  )
}

/**
 * Parse one stdout line into a runtime message.
 * Returns `null` when the line is not a valid protocol message — the caller
 * then reports a protocol violation (never silently drop stdout garbage).
 */
export function parseRuntimeMessage(line: string): RuntimeMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null

  if (parsed['type'] === 'event') {
    if (typeof parsed['event'] !== 'string' || parsed['event'].length === 0) return null
    const envelope: RpcEventEnvelope = { type: 'event', event: parsed['event'] }
    if ('payload' in parsed) envelope.payload = parsed['payload']
    if (typeof parsed['sequence'] === 'number') envelope.sequence = parsed['sequence']
    if (typeof parsed['timestamp'] === 'number') envelope.timestamp = parsed['timestamp']
    if (typeof parsed['generationId'] === 'string') envelope.generationId = parsed['generationId']
    return envelope
  }

  if (!isValidId(parsed['id'])) return null
  if ('result' in parsed && 'error' in parsed) return null

  if ('result' in parsed) {
    return { id: parsed['id'], result: parsed['result'] }
  }
  if ('error' in parsed) {
    if (!isRpcErrorPayload(parsed['error'])) return null
    return { id: parsed['id'], error: parsed['error'] }
  }
  return null
}

/**
 * Parse one stdin line into a host request.
 * Returns `{ ok: false, id?, error }` for malformed requests so the caller can
 * answer with a proper error when an id is recoverable.
 */
export function parseHostRequest(
  line: string
): { ok: true; request: RpcRequest } | { ok: false; id: string | null; error: RpcErrorPayload } {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return { ok: false, id: null, error: { code: 'INVALID_REQUEST', message: 'Line is not JSON' } }
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      id: null,
      error: { code: 'INVALID_REQUEST', message: 'Message is not an object' }
    }
  }

  const id = isValidId(parsed['id']) ? parsed['id'] : null
  if (!id) {
    return {
      ok: false,
      id: null,
      error: { code: 'INVALID_REQUEST', message: 'Missing or invalid "id"' }
    }
  }
  if (!isValidMethodName(parsed['method'])) {
    return {
      ok: false,
      id,
      error: { code: 'INVALID_REQUEST', message: 'Missing or invalid "method"' }
    }
  }
  const params = parsed['params']
  if (params !== undefined && !isPlainObject(params)) {
    return {
      ok: false,
      id,
      error: { code: 'INVALID_REQUEST', message: '"params" must be an object when present' }
    }
  }
  return { ok: true, request: { id, method: parsed['method'], params } }
}

export function serializeRequest(request: RpcRequest): string {
  return JSON.stringify({ id: request.id, method: request.method, params: request.params ?? {} })
}

export function serializeResponse(id: string, outcome: RpcResult): string {
  if (outcome.ok) {
    return JSON.stringify({ id, result: outcome.result })
  }
  return JSON.stringify({ id, error: outcome.error })
}

/** Optional metadata the sequenced emitter adds to every event envelope. */
export interface RpcEventMeta {
  sequence: number
  timestamp: number
  generationId?: string
}

export function serializeEvent(event: string, payload?: unknown, meta?: RpcEventMeta): string {
  const envelope: RpcEventEnvelope =
    payload === undefined ? { type: 'event', event } : { type: 'event', event, payload }
  if (meta) {
    envelope.sequence = meta.sequence
    envelope.timestamp = meta.timestamp
    if (meta.generationId) envelope.generationId = meta.generationId
  }
  return JSON.stringify(envelope)
}

export function rpcError(code: RpcErrorCode, message: string, data?: unknown): RpcErrorPayload {
  return data === undefined ? { code, message } : { code, message, data }
}
