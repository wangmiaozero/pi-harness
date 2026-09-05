import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentEventBatcher, type AgentEventEnvelope } from './agent-event-batcher'

describe('AgentEventBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers a single event with the legacy envelope shape', () => {
    const sink = vi.fn()
    const batcher = new AgentEventBatcher(sink, 16)

    batcher.push({ sessionId: 's1', event: { type: 'agent_start' } })
    expect(sink).not.toHaveBeenCalled()

    vi.advanceTimersByTime(16)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith({ sessionId: 's1', event: { type: 'agent_start' } })
  })

  it('coalesces a burst into one ordered batch', () => {
    const sink = vi.fn()
    const batcher = new AgentEventBatcher(sink, 16)

    batcher.push({ sessionId: 's1', event: { type: 'message_update', delta: 'a' } })
    batcher.push({ sessionId: 's1', event: { type: 'message_update', delta: 'b' } })
    batcher.push({ sessionId: 's2', event: { type: 'message_end' } })
    vi.advanceTimersByTime(16)

    expect(sink).toHaveBeenCalledTimes(1)
    const batch = sink.mock.calls[0]?.[0] as AgentEventEnvelope[]
    expect(Array.isArray(batch)).toBe(true)
    expect(batch.map((item) => (item.event as { delta?: string }).delta)).toEqual(['a', 'b', undefined])
    expect(batch.map((item) => item.sessionId)).toEqual(['s1', 's1', 's2'])
  })

  it('flushes on the first deadline even when more events arrive', () => {
    const sink = vi.fn()
    const batcher = new AgentEventBatcher(sink, 16)

    batcher.push({ sessionId: 's1', event: { type: 'agent_start' } })
    vi.advanceTimersByTime(15)
    batcher.push({ sessionId: 's1', event: { type: 'message_update' } })
    vi.advanceTimersByTime(1)

    expect(sink).toHaveBeenCalledTimes(1)
    const batch = sink.mock.calls[0]?.[0] as AgentEventEnvelope[]
    expect(batch).toHaveLength(2)
  })

  it('does not reschedule after an empty flush', () => {
    const sink = vi.fn()
    const batcher = new AgentEventBatcher(sink, 16)

    batcher.push({ sessionId: 's1', event: { type: 'agent_start' } })
    batcher.flush()
    expect(sink).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(64)
    expect(sink).toHaveBeenCalledTimes(1)

    batcher.push({ sessionId: 's1', event: { type: 'agent_end' } })
    vi.advanceTimersByTime(16)
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('drops queued events after dispose', () => {
    const sink = vi.fn()
    const batcher = new AgentEventBatcher(sink, 16)

    batcher.push({ sessionId: 's1', event: { type: 'agent_start' } })
    batcher.dispose()
    vi.advanceTimersByTime(64)

    expect(sink).not.toHaveBeenCalled()
  })
})
