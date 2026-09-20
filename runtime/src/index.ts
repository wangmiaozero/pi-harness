/**
 * Pi-Harness runtime sidecar entry point.
 *
 * Boot sequence:
 * 1. Wire a line reader on stdin and a protocol writer on stdout.
 * 2. Emit `runtime.ready` with identity/protocol versions.
 * 3. For each request line: validate, dispatch, respond exactly once.
 * 4. On SIGTERM/SIGINT or `runtime.shutdown`: respond, flush, exit 0.
 *
 * stdout is protocol-only. Every diagnostic goes to stderr.
 */

import { createLineReader, createStdoutWriter, logDiagnostic } from './transport/jsonl.js'
import {
  parseHostRequest,
  serializeEvent,
  serializeResponse,
  type RpcErrorPayload
} from './protocol/messages.js'
import { dispatch } from './protocol/dispatch.js'
import { PROTOCOL_VERSION, RUNTIME_VERSION } from './version.js'

const startedAt = Date.now()
const writer = createStdoutWriter()

let shuttingDown = false
let shutdownReason = 'unknown'

function emit(event: string, payload?: unknown): void {
  if (shuttingDown && event !== 'runtime.stopping') return
  writer.write(serializeEvent(event, payload))
}

function requestShutdown(reason: string): void {
  if (shuttingDown) return
  shuttingDown = true
  shutdownReason = reason
  emit('runtime.stopping', { reason })
  // Give stdout a tick to flush, then exit cleanly. The host also enforces its
  // own stop timeout and can kill the process if this path hangs.
  setImmediate(() => {
    logDiagnostic(`shutting down: ${shutdownReason}`)
    process.exit(0)
  })
}

const context = { startedAt, emit, requestShutdown }

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
  const outcome = await dispatch(method, params, context)
  writer.write(serializeResponse(id, outcome))
}

async function main(): Promise<void> {
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
    await handleLine(item.line)
  }

  // stdin closed — the host is gone.
  logDiagnostic('stdin closed')
  process.exit(0)
}

main().catch((error: unknown) => {
  logDiagnostic(`fatal: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
