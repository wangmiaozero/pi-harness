/**
 * Runtime RPC error taxonomy.
 *
 * Protocol-level codes mirror `src-tauri/src/runtime/protocol.rs` and
 * `docs/tauri-migration/protocol.md`. Domain codes line up with the renderer's
 * `AppErrorCode` vocabulary wherever one exists, so errors survive the
 * Rust → bridge hop without translation.
 */

import { sanitizeRuntimeErrorMessage } from '../support/runtime-error.js'

export const RUNTIME_ERROR_CODES = [
  // Protocol level
  'INVALID_REQUEST',
  'METHOD_NOT_FOUND',
  'INTERNAL_ERROR',
  'SHUTDOWN',
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
  'CAPABILITY_NOT_SUPPORTED'
] as const

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number]

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode
  readonly recoverable: boolean
  readonly userMessage: string

  constructor(
    code: RuntimeErrorCode,
    message: string,
    options: { recoverable?: boolean; userMessage?: string; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'RuntimeError'
    this.code = code
    this.recoverable = options.recoverable ?? true
    this.userMessage = options.userMessage ?? sanitizeRuntimeErrorMessage(message)
  }

  toJSON(): { code: RuntimeErrorCode; message: string; userMessage: string; recoverable: boolean } {
    return {
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      recoverable: this.recoverable
    }
  }
}

/** Normalize any thrown value into a `RuntimeError`. */
export function toRuntimeError(
  raw: unknown,
  fallbackCode: RuntimeErrorCode = 'INTERNAL_ERROR'
): RuntimeError {
  if (raw instanceof RuntimeError) return raw
  const message =
    raw instanceof Error
      ? raw.message
      : typeof raw === 'string'
        ? raw
        : JSON.stringify(raw) || 'Unknown error'
  return new RuntimeError(fallbackCode, message, { cause: raw, recoverable: true })
}

/** Validation helper: assert params[ key ] is a string. */
export function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new RuntimeError('INVALID_INPUT', `Parameter "${key}" must be a non-empty string`)
  }
  return value
}

export function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new RuntimeError('INVALID_INPUT', `Parameter "${key}" must be a string`)
  }
  return value
}

export function optionalStringArray(
  params: Record<string, unknown>,
  key: string
): string[] | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new RuntimeError('INVALID_INPUT', `Parameter "${key}" must be an array of strings`)
  }
  return value as string[]
}
