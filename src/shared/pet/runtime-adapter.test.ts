import { describe, expect, it } from 'vitest'
import { adaptAgentEventToPetEvents } from './runtime-adapter'
import type { AgentEvent } from '../types/workspace'

function adapt(event: Record<string, unknown>) {
  return adaptAgentEventToPetEvents(event as AgentEvent)
}

describe('pet runtime adapter', () => {
  it('maps lifecycle and completion events', () => {
    expect(adapt({ type: 'agent_start' })).toEqual([{ type: 'TASK_STARTED' }])
    expect(adapt({ type: 'prompt_done' })).toEqual([{ type: 'TASK_SUCCEEDED', celebrate: true }])
    expect(adapt({ type: 'prompt_done', success: false })).toEqual([{ type: 'TASK_FAILED' }])
    expect(adapt({ type: 'prompt_error' })).toEqual([{ type: 'TASK_FAILED' }])
    expect(adapt({ type: 'agent_end' })).toEqual([{ type: 'RUNTIME_SETTLED' }])
  })

  it('maps assistant thinking, streaming, and tool events', () => {
    expect(
      adapt({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta' } })
    ).toEqual([{ type: 'THINKING_STARTED' }])
    expect(
      adapt({ type: 'message_update', assistantMessageEvent: { type: 'text_delta' } })
    ).toEqual([{ type: 'STREAM_STARTED' }])
    expect(
      adapt({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'apply_patch'
      })
    ).toEqual([{ type: 'TOOL_CALL_STARTED', id: 'call-1', tool: 'apply_patch' }])
    expect(adapt({ type: 'tool_execution_end', toolCallId: 'call-1', isError: true })).toEqual([
      { type: 'TOOL_CALL_FINISHED', id: 'call-1', failed: true }
    ])
  })

  it('maps retry events to warning state', () => {
    expect(adapt({ type: 'auto_retry_start', delayMs: 1000 })).toEqual([
      { type: 'WARNING', durationMs: 3000 }
    ])
    expect(adapt({ type: 'auto_retry_end', success: true })).toEqual([{ type: 'WARNING_CLEARED' }])
  })
})
