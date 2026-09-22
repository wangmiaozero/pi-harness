/**
 * Pi-Harness runtime sidecar entry point.
 *
 * Boot sequence:
 * 1. Apply the Pi agent-dir environment override (before any SDK load).
 * 2. Wire services (sessions/agent/harness) with event sinks routed through a
 *    sequenced emitter; compose the full RPC method registry.
 * 3. Emit `runtime.ready` with identity/protocol versions.
 * 4. For each request line: validate, dispatch, respond exactly once.
 *    Dispatch is concurrent — a slow method (e.g. `harness.compact`) never
 *    blocks later requests; responses correlate by id.
 * 5. On SIGTERM/SIGINT or `runtime.shutdown`: emit `runtime.stopping`,
 *    stop every live agent session, flush pending event batches, exit 0
 *    (2s watchdog guards against a hung SDK).
 *
 * stdout is protocol-only. Every diagnostic goes to stderr.
 */

import { createLineReader, createStdoutWriter, logDiagnostic } from './transport/jsonl.js'
import { parseHostRequest, serializeResponse, type RpcErrorPayload } from './protocol/messages.js'
import { RuntimeEventEmitter } from './protocol/emitter.js'
import { createMethodRegistry, createDispatcher } from './protocol/dispatch.js'
import { createRuntimeServices } from './services.js'
import { resolveConfiguredSdkLoader } from './pi/sdk.js'
import { applyAgentDirOverride } from './pi/environment.js'
import { PROTOCOL_VERSION, RUNTIME_VERSION } from './version.js'

const startedAt = Date.now()
const writer = createStdoutWriter()
const emitter = new RuntimeEventEmitter({ writeLine: (line) => writer.write(line) })

const services = createRuntimeServices({
  loadSdk: resolveConfiguredSdkLoader(),
  log: logDiagnostic,
  onAgentEvent: (batch) => emitter.emit('agent.event', batch),
  onRunningChange: (ids) => emitter.emit('agent.running', { ids }),
  onHarnessEvent: (sessionId, event) => emitter.emit('harness.event', { sessionId, event }),
  onConfigChanged: (payload) => emitter.emit('config.changed', payload),
  onEnvironmentChanged: (environment) => emitter.emit('pi.environment-changed', environment),
  onInstallTask: (task) => emitter.emit('environment.install-task', task),
  onCapabilityProgress: (progress) => emitter.emit('capability.progress', progress)
})

const registry = createMethodRegistry(services)

let shuttingDown = false
let exitQueued = false

function emit(event: string, payload?: unknown): void {
  emitter.emit(event, payload)
}

function requestShutdown(reason: string): void {
  if (exitQueued) return
  exitQueued = true
  shuttingDown = true
  emit('runtime.stopping', { reason })
  void gracefulExit()
}

/** Stop all live sessions, flush event batches, then exit 0. */
async function gracefulExit(): Promise<void> {
  const watchdog = setTimeout(() => {
    logDiagnostic('shutdown watchdog fired — forcing exit')
    process.exit(0)
  }, 2000)
  if (typeof watchdog.unref === 'function') watchdog.unref()
  try {
    await services.shutdown()
  } catch (raw) {
    logDiagnostic(`shutdown cleanup failed: ${raw instanceof Error ? raw.message : String(raw)}`)
  }
  // Let pending microtasks (in-flight response writes) settle before exit.
  await new Promise<void>((resolve) => setImmediate(resolve))
  process.exit(0)
}

const context = { startedAt, emit, requestShutdown }
const registryDispatch = createDispatcher(registry)

async function handleLine(line: string): Promise<void> {
  const parsed = parseHostRequest(line)
  if (!parsed.ok) {
    const error: RpcErrorPayload = parsed.error
    if (parsed.id === null) {
      // No recoverable id — cannot answer; report on stderr only.
      logDiagnostic(`invalid request (${error.code}): ${error.message}`)
      emit('runtime.protocol-violation', { message: error.message })
      return
    }
    writer.write(serializeResponse(parsed.id, { ok: false, error }))
    return
  }

  const { id, method } = parsed.request
  const params = parsed.request.params ?? {}
  const outcome = await registryDispatch(method, params, context)
  writer.write(serializeResponse(id, outcome))
}

async function main(): Promise<void> {
  applyAgentDirOverride()
  process.on('SIGTERM', () => requestShutdown('SIGTERM'))
  process.on('SIGINT', () => requestShutdown('SIGINT'))
  // EPIPE: host closed the pipe — exit quietly rather than crash noisily.
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0)
  })

  emit('runtime.ready', {
    runtimeVersion: RUNTIME_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    pid: process.pid
  })
  logDiagnostic(`ready (runtime ${RUNTIME_VERSION}, protocol ${PROTOCOL_VERSION})`)

  const reader = createLineReader(process.stdin)
  for await (const item of reader.read()) {
    if (item.kind === 'violation') {
      logDiagnostic('protocol violation: oversized input line')
      emit('runtime.protocol-violation', { message: 'oversized input line' })
      continue
    }
    if (shuttingDown) {
      // Drain remaining input quietly; requests racing with shutdown get a
      // typed error (with their own id) so the host can map them to a
      // restart, not a timeout.
      const parsed = parseHostRequest(item.line)
      const id = parsed.ok ? parsed.request.id : parsed.id
      if (id !== null && parsed.ok && parsed.request.method === 'runtime.shutdown') {
        writer.write(serializeResponse(id, { ok: true, result: { stopping: true } }))
        continue
      }
      if (id !== null) {
        writer.write(
          serializeResponse(id, {
            ok: false,
            error: { code: 'SHUTDOWN', message: 'Runtime is shutting down' }
          })
        )
      }
      continue
    }
    // Concurrent dispatch: slow methods (compaction can take minutes) must
    // not block later requests. Responses correlate by id; the writer is
    // synchronous, so line order on stdout is preserved.
    void handleLine(item.line).catch((raw: unknown) => {
      logDiagnostic(`request handling failed: ${raw instanceof Error ? raw.message : String(raw)}`)
    })
  }

  // stdin closed — the host is gone. Clean up, then exit.
  logDiagnostic('stdin closed')
  if (!exitQueued) {
    exitQueued = true
    shuttingDown = true
    emit('runtime.stopping', { reason: 'stdin closed' })
  }
  await gracefulExit()
}

main().catch((error: unknown) => {
  logDiagnostic(`fatal: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
