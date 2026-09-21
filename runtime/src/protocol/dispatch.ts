/**
 * Method registry for the runtime RPC dispatcher.
 *
 * Method names follow the `domain.action` convention shared with the desktop
 * host (see docs/tauri-migration/protocol.md). Handlers receive the raw
 * `params` object, validate it themselves (zero-dependency runtime), and
 * return a JSON-serialisable result or throw; the dispatcher converts thrown
 * values into typed RPC errors, preserving `RuntimeError` domain codes and
 * sanitized `userMessage`s so the desktop host can surface them verbatim.
 *
 * `runtime.*` methods form the base registry (always available — the
 * supervisor health-checks them before the desktop UI is up). The domain
 * methods (session.*, agent.*, harness.*) are composed in via
 * `createMethodRegistry(services)`; production `index.ts` always passes real
 * services, tests pass mock services or none at all.
 */

import { PROTOCOL_VERSION, RUNTIME_VERSION } from '../version.js'
import { RuntimeError, toRuntimeError } from '../pi/errors.js'
import type { RuntimeServices } from '../services.js'
import { peekPiSdk, getPiSdkLoadMetrics } from '../pi/sdk.js'
import { registerDomainMethods } from './domain-methods.js'
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

export type RpcMethodRegistry = Record<string, RpcHandler>

const runtimePid = (): number | null => {
  const pid = typeof process !== 'undefined' ? process.pid : null
  return Number.isFinite(pid) ? pid : null
}

const uptimeMs = (startedAt: number): number => Date.now() - startedAt

function toErrorPayload(error: unknown): RpcErrorPayload {
  if (error instanceof RuntimeError) {
    const payload: RpcErrorPayload = {
      code: error.code,
      message: error.message,
      userMessage: error.userMessage
    }
    if (!error.recoverable) payload.data = { recoverable: false }
    return payload
  }
  const normalized = toRuntimeError(error)
  return {
    code: normalized.code,
    message: normalized.message,
    userMessage: normalized.userMessage
  }
}

const baseMethods: RpcMethodRegistry = {
  'runtime.ping': () => ({ pong: true, timestamp: Date.now() }),

  'runtime.version': () => ({
    runtimeVersion: RUNTIME_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    nodeVersion: process.version
  }),

  'runtime.status': (_params, context) =>
    statusPayload(context, { firstAgentStartMs: null }, peekPiSdk() !== null),

  'runtime.shutdown': (_params, context) => {
    context.requestShutdown('runtime.shutdown request')
    return { stopping: true }
  }
}

/**
 * Full status payload, including SDK + agent metrics.
 * `sdkLoaded` comes from the live services when present (injected test
 * loaders bypass the module cache), otherwise from the module cache.
 */
function statusPayload(
  context: RpcMethodContext,
  metrics: { firstAgentStartMs: number | null },
  sdkLoaded: boolean
): Record<string, unknown> {
  const sdkMetrics = getPiSdkLoadMetrics()
  return {
    running: true,
    pid: runtimePid(),
    uptimeMs: uptimeMs(context.startedAt),
    runtimeVersion: RUNTIME_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    sdkLoaded,
    piSdkLoadMs: sdkMetrics ? sdkMetrics.loadMs : null,
    firstAgentStartMs: metrics.firstAgentStartMs
  }
}

/**
 * Compose the full method registry. `services === null` yields the base
 * registry alone (supervisor-level operation without the desktop domain).
 */
export function createMethodRegistry(services: RuntimeServices | null): RpcMethodRegistry {
  if (!services) {
    return {
      ...baseMethods,
      'runtime.status': (_params, context) =>
        statusPayload(context, { firstAgentStartMs: null }, peekPiSdk() !== null)
    }
  }
  const methods: RpcMethodRegistry = {
    ...baseMethods,
    'runtime.status': (_params, context) =>
      statusPayload(
        context,
        { firstAgentStartMs: services.agent.firstStartAt },
        services.agent.diagnostics().sdkLoaded
      )
  }
  registerDomainMethods(methods, services)
  return methods
}

export function listMethods(registry: RpcMethodRegistry = baseMethods): string[] {
  return Object.keys(registry).sort()
}

export function hasMethod(method: string, registry: RpcMethodRegistry = baseMethods): boolean {
  return Object.prototype.hasOwnProperty.call(registry, method)
}

export function createDispatcher(registry: RpcMethodRegistry) {
  return async function dispatch(
    method: string,
    params: RpcParams,
    context: RpcMethodContext
  ): Promise<{ ok: true; result: unknown } | { ok: false; error: RpcErrorPayload }> {
    const handler = registry[method]
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
}

/**
 * Convenience dispatcher over the base registry — used by tests and by any
 * host that runs the runtime without desktop services wired.
 */
export const dispatch = createDispatcher(baseMethods)
