/**
 * RuntimeEventEmitter tests: monotonic sequence stamping, envelope shape and
 * payload handling (task §33: "Event envelope / sequence").
 */

import { describe, expect, it } from 'vitest'
import { RuntimeEventEmitter, type EventLineWriter } from './emitter.js'
import { parseRuntimeMessage } from './messages.js'

function recordingWriter(): { lines: string[]; writer: EventLineWriter } {
  const lines: string[] = []
  return { lines, writer: { writeLine: (line) => lines.push(line) } }
}

describe('RuntimeEventEmitter', () => {
  it('stamps a monotonic sequence and epoch timestamp on every event', () => {
    const { lines, writer } = recordingWriter()
    const emitter = new RuntimeEventEmitter(writer)
    emitter.emit('runtime.ready', { pid: 1 })
    emitter.emit('agent.event', { sessionId: 's', event: { type: 'agent_start' } })
    emitter.emit('agent.running')

    const envelopes = lines.map((line) => parseRuntimeMessage(line))
    expect(envelopes).toHaveLength(3)
    expect(emitter.count).toBe(3)

    const first = envelopes[0] as { sequence?: number; timestamp?: number; event: string }
    const second = envelopes[1] as { sequence?: number; event: string }
    const third = envelopes[2] as { sequence?: number; event: string; payload?: unknown }
    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
    expect(third.sequence).toBe(3)
    expect(typeof first.timestamp).toBe('number')
    expect(first.event).toBe('runtime.ready')
    expect((envelopes[0] as { payload?: unknown }).payload).toEqual({ pid: 1 })
    expect('payload' in (third as object)).toBe(false)
  })

  it('keeps every envelope on a single protocol line', () => {
    const { lines, writer } = recordingWriter()
    const emitter = new RuntimeEventEmitter(writer)
    emitter.emit('harness.event', { sessionId: 's', event: { type: 'runtime.started' } })
    for (const line of lines) {
      expect(line.trim()).toBe(line)
      expect(line.endsWith('\n')).toBe(false)
    }
  })
})
