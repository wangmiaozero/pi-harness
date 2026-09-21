/**
 * Sequenced runtime event emitter.
 *
 * Every unsolicited event the runtime pushes to the host goes through this
 * emitter, which stamps a monotonic per-process `sequence` and an epoch-ms
 * `timestamp` onto the envelope and writes it to the underlying writer.
 * Responses never carry a sequence — only events do — so the host can
 * distinguish and reorder them even across interleaved writers.
 */

import { serializeEvent } from './messages.js'

/** Minimal line-oriented writer (stdout in production, strings in tests). */
export interface EventLineWriter {
  /** Append one protocol line. Must not throw on backpressure. */
  writeLine(line: string): void
}

export class RuntimeEventEmitter {
  private sequence = 0
  private readonly writer: EventLineWriter

  constructor(writer: EventLineWriter) {
    this.writer = writer
  }

  /** Number of events emitted so far (for tests/diagnostics). */
  get count(): number {
    return this.sequence
  }

  /** Emit an unsolicited event envelope on the protocol stream. */
  emit(event: string, payload?: unknown): void {
    this.sequence += 1
    this.writer.writeLine(
      serializeEvent(event, payload, { sequence: this.sequence, timestamp: Date.now() })
    )
  }
}
