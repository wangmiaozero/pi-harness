import { describe, expect, it } from 'vitest'
import { normalizeStreamingToolCalls, normalizeToolCalls } from './normalize'
import type { AgentMessage } from '../types/workspace'

describe('tool call normalization', () => {
  it('maps persisted {id,name,arguments} onto ToolCallContent', () => {
    const msg = {
      role: 'assistant',
      model: 'x',
      provider: 'p',
      content: [
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'read',
          arguments: { path: 'a.ts' }
        }
      ]
    } as unknown as AgentMessage

    const normalized = normalizeToolCalls(msg)
    expect(normalized.role).toBe('assistant')
    if (normalized.role !== 'assistant') return
    expect(normalized.content[0]).toEqual({
      type: 'toolCall',
      toolCallId: 'call-1',
      toolName: 'read',
      input: { path: 'a.ts' }
    })
  })

  it('leaves non-assistant messages unchanged', () => {
    const msg: AgentMessage = { role: 'user', content: 'hi' }
    expect(normalizeToolCalls(msg)).toBe(msg)
  })

  it('keeps streaming rawInput on the live tool call', () => {
    const msg = {
      role: 'assistant',
      model: 'x',
      provider: 'p',
      content: [
        {
          type: 'toolCall',
          toolCallId: 'c',
          toolName: 'bash',
          input: {},
          rawInput: '{"cmd":'
        }
      ]
    } as AgentMessage
    const normalized = normalizeStreamingToolCalls(msg)
    if (normalized.role !== 'assistant') return
    const block = normalized.content[0]
    expect(block.type).toBe('toolCall')
    if (block.type === 'toolCall') expect(block.rawInput).toBe('{"cmd":')
  })

  it('preserves unknown assistant content blocks', () => {
    const msg = {
      role: 'assistant',
      model: 'x',
      provider: 'p',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'future', payload: 1 }
      ]
    } as unknown as AgentMessage
    const normalized = normalizeToolCalls(msg)
    if (normalized.role !== 'assistant') return
    expect(normalized.content[1]).toEqual({ type: 'future', payload: 1 })
  })
})
