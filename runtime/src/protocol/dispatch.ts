/**
 * Method registry for the runtime RPC dispatcher.
 *
 * Method names follow the `domain.action` convention shared with the desktop
 * host (see docs/tauri-migration/protocol.md). Handlers receive the validated
 * `params` object and return a JSON-serialisable result or throw; the
 * dispatcher converts thrown values into typed RPC errors.
 */

import { PROTOCOL_VERSION, RUNTIME_VERSION } from '../version.js'
import type { RpcErrorPayload } from './messages.js'
import { rpcError } from './messages.js'

export type RpcParams = Record<string, unknown>

export interface RpcMethodContext {
  /** Registered at boot. */
  startedAt: number
  /** Emits an unsolicited event to the host (stdout, protocol-only). */
  emit: (event: string, payload?: unknown) => void
  /** Initiate a graceful shutdown (flushes stdout first). */
  requestShutdown: (reason: string) => void
}

export type RpcHandler = (
  params: RpcParams,
  context: RpcMethodContext
) => unknown | Promise<unknown>

const runtimePid = (): number | null => {
  const pid = typeof process !== 'undefined' ? process.pid : null
  return Number.isFinite(pid) ? pid : null
}

const uptimeMs = (startedAt: number): number => Date.now() - startedAt

function toErrorPayload(error: unknown): RpcErrorPayload {
  if (error instanceof Error) {
    return rpcError('INTERNAL_ERROR', error.message)
  }
  if (typeof error === 'string') {
    return rpcError('INTERNAL_ERROR', error)
  }
  return rpcError('INTERNAL_ERROR', 'Unknown handler failure')
}

const methods: Record<string, RpcHandler> = {
  'runtime.ping': () => ({ pong: true, timestamp: Date.now() }),

  'runtime.version': () => ({
    runtimeVersion: RUNTIME_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    nodeVersion: process.version
  }),

  'runtime.status': (_params, context) => ({
    running: true,
    pid: runtimePid(),
    uptimeMs: uptimeMs(context.startedAt),
    runtimeVersion: RUNTIME_VERSION,
    protocolVersion: PROTOCOL_VERSION
  }),

  'runtime.shutdown': (_params, context) => {
    context.requestShutdown('runtime.shutdown request')
    return { stopping: true }
  }
}

export function listMethods(): string[] {
  return Object.keys(methods).sort()
}

export function hasMethod(method: string): boolean {
  return Object.prototype.hasOwnProperty.call(methods, method)
}

export async function dispatch(
  method: string,
  params: RpcParams,
  context: RpcMethodContext
): Promise<{ ok: true; result: unknown } | { ok: false; error: RpcErrorPayload }> {
  const handler = methods[method]
  if (typeof handler !== 'function') {
    return {
      ok: false,
      error: rpcError('METHOD_NOT_FOUND', `Unknown method: ${method}`, { method })
    }
  }
  try {
    const result = await handler(params, context)
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: toErrorPayload(error) }
  }
}
