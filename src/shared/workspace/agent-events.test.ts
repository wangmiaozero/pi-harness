import { describe, expect, it } from 'vitest'
import { streamReducer, INITIAL_STREAMING_STATE } from './streaming-message'
import { toClientAgentEvent } from './agent-event-wire'
import { startAgentSessionSchema, workspacePathSchema } from '../schemas/workspace'

describe('agent event normalization', () => {
  it('drops turn noise and strips bulky partial payloads', () => {
    expect(toClientAgentEvent({ type: 'turn_start' })).toBeNull()
    const event = toClientAgentEvent({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Hi',
        partial: { content: [{ type: 'text', text: 'Hi' }] }
      }
    })
    expect(event).toEqual({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hi' }
    })
  })

  it('applies text deltas incrementally', () => {
    let state = streamReducer(INITIAL_STREAMING_STATE, {
      type: 'snapshot',
      message: { role: 'assistant', model: 'm', provider: 'p', content: [] }
    })
    state = streamReducer(state, {
      type: 'delta',
      event: { type: 'text_start', contentIndex: 0 }
    })
    state = streamReducer(state, {
      type: 'delta',
      event: { type: 'text_delta', contentIndex: 0, delta: 'Hel' }
    })
    state = streamReducer(state, {
      type: 'delta',
      event: { type: 'text_delta', contentIndex: 0, delta: 'lo' }
    })
    expect(state.streamingMessage?.content).toEqual([{ type: 'text', text: 'Hello' }])
  })
})

describe('workspace IPC schemas', () => {
  it('rejects path null bytes and empty session ids', () => {
    expect(workspacePathSchema.safeParse('/tmp/\0x').success).toBe(false)
    expect(startAgentSessionSchema.safeParse({ sessionId: '' }).success).toBe(false)
    expect(startAgentSessionSchema.safeParse({ cwd: '/tmp/app', message: 'hi' }).success).toBe(true)
  })
})
