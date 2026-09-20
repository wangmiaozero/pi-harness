/**
 * Line-delimited JSON transport over the sidecar's stdin/stdout.
 *
 * stdout carries protocol messages only. Human diagnostics go to stderr so
 * the JSONL stream is never corrupted. Input is read as whole lines with a
 * bounded length; oversized input is reported instead of buffering unbounded
 * memory.
 */

import { createInterface } from 'node:readline'

/** Hard cap per line (defensive — valid messages are far smaller). */
const MAX_LINE_BYTES = 4 * 1024 * 1024

export interface ProtocolWriter {
  /** Write one serialised protocol message, framed by newline. */
  write(message: string): void
}

export interface LineInput {
  /** Yields raw non-empty lines, or violations for oversized lines. */
  read(): AsyncIterable<{ kind: 'line'; line: string } | { kind: 'violation' }>
}

export function createStdoutWriter(output: NodeJS.WritableStream = process.stdout): ProtocolWriter {
  return {
    write(message: string): void {
      // Blocking write keeps strict line ordering; sidecar throughput is low.
      output.write(`${message}\n`)
    }
  }
}

export function createLineReader(input: NodeJS.ReadableStream = process.stdin): LineInput {
  return {
    async *read(): AsyncIterable<{ kind: 'line'; line: string } | { kind: 'violation' }> {
      const readline = createInterface({ input, crlfDelay: Infinity })
      try {
        for await (const line of readline) {
          if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
            yield { kind: 'violation' }
            continue
          }
          if (line.trim().length === 0) continue
          yield { kind: 'line', line }
        }
      } finally {
        readline.close()
      }
    }
  }
}

/** Stderr diagnostics helper — never touches stdout. */
export function logDiagnostic(message: string): void {
  process.stderr.write(`[pi-harness-runtime] ${message}\n`)
}
