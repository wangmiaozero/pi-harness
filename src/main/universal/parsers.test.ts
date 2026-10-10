import { describe, it, expect } from 'vitest'
import { parseSession, hash } from './parsers'
import { redact, serialized } from './normalize'
import type { SourceProvider } from '@shared/universal/schema'
const parse = (provider: SourceProvider, records: unknown[]) =>
  parseSession({
    provider,
    records,
    file: '/source/test.jsonl',
    root: '/source',
    fingerprint: hash('source'),
    mtime: '2026-10-01T00:00:00.000Z'
  })

describe('CCHV-compatible P0 formats', () => {
  it('reads Claude content, tool calls, images, usage and Unicode without changing the native format', () => {
    const p = parse('claude', [
      {
        type: 'user',
        sessionId: 'claude-1',
        uuid: 'u',
        cwd: '/workspace/中文',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '请修复 Unicode' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture' } }
          ]
        }
      },
      {
        type: 'assistant',
        uuid: 'a',
        message: {
          id: 'response-1',
          role: 'assistant',
          model: 'claude-sonnet',
          usage: { input_tokens: 10, output_tokens: 4 },
          content: [
            { type: 'thinking', thinking: '分析' },
            { type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: 'src/a.ts' } }
          ]
        }
      },
      {
        type: 'user',
        uuid: 'r',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'export {}' }]
        }
      }
    ])
    expect(p.session.projectPath).toBe('/workspace/中文')
    expect(p.session.title).toBe('请修复 Unicode')
    expect(p.session.metadata).toMatchObject({ tokens: 14, hasToolCalls: true })
    expect(p.messages[0]?.parts[1]).toEqual({
      type: 'image-reference',
      reference: '[embedded image]',
      mimeType: 'image/png'
    })
    expect(p.messages[1]?.parts.map((p) => p.type)).toEqual(['thinking', 'tool-call', 'usage'])
    expect(p.messages[2]?.parts[0]).toMatchObject({
      type: 'tool-result',
      callId: 'call-1',
      text: 'export {}'
    })
  })
  it('deduplicates Claude partial response usage and duplicate native UUIDs', () => {
    const rows = [1, 2].map((n) => ({
      type: 'assistant',
      uuid: `chunk-${n}`,
      message: {
        id: 'one-response',
        role: 'assistant',
        content: 'part',
        usage: { input_tokens: 10, output_tokens: n }
      }
    }))
    const p = parse('claude', [...rows, rows[1]])
    expect(p.messages).toHaveLength(2)
    expect(p.session.metadata.tokens).toBe(12)
  })
  it('reads Codex rollout tools, reasoning and cumulative usage once, without mirrored text', () => {
    const p = parse('codex', [
      { type: 'session_meta', payload: { id: 'codex-1', cwd: '/project' } },
      { type: 'turn_context', payload: { model: 'gpt-5' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'duplicate' } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '修复测试' }]
        }
      },
      {
        type: 'response_item',
        payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'plan' }] }
      },
      {
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          call_id: 'c1',
          name: 'apply_patch',
          input: '*** Begin Patch'
        }
      },
      {
        type: 'response_item',
        payload: { type: 'custom_tool_call_output', call_id: 'c1', output: 'ok' }
      },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 } }
        }
      },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 35, output_tokens: 15, total_tokens: 50 } }
        }
      }
    ])
    expect(p.messages).toHaveLength(4)
    expect(p.session.nativeSessionId).toBe('codex-1')
    expect(p.session.metadata.tokens).toBe(50)
    expect(p.messages[2]?.parts[0]).toMatchObject({ type: 'tool-call', callId: 'c1' })
    expect(p.messages[3]?.parts[0]).toMatchObject({ type: 'tool-result', text: 'ok' })
  })
  it('reads Cursor Agent transcripts with command output and nested tool results', () => {
    const p = parse('cursor-agent', [
      {
        role: 'user',
        message: { content: [{ type: 'text', text: '<user_query>继续任务</user_query>' }] }
      },
      {
        role: 'assistant',
        message: {
          content: [
            { type: 'command_output', output: 'stdout' },
            { type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: 'nested' }] }
          ]
        }
      }
    ])
    expect(p.messages).toHaveLength(2)
    expect(p.messages[1]?.parts[0]).toMatchObject({ type: 'text', text: 'stdout' })
    expect(p.messages[0]?.parts[0]).toMatchObject({ type: 'text', text: '继续任务' })
    expect(p.messages[1]?.parts[1]).toMatchObject({ type: 'tool-result' })
  })
  it('ports CCHV Gemini JSONL metadata updates, content parts, tool calls and thought tokens', () => {
    const p = parse('gemini', [
      { sessionId: 's-jsonl', projectHash: 'hash-2', startTime: '2026-06-01T00:00:00Z' },
      {
        id: 'u1',
        timestamp: '2026-06-01T00:00:01Z',
        type: 'user',
        content: [{ text: 'need help' }]
      },
      { $set: { lastUpdated: '2026-06-01T01:00:00Z' } },
      {
        id: 'g1',
        type: 'gemini',
        thoughts: [{ subject: '计划', description: '实现' }],
        content: [{ text: 'sure' }],
        toolCalls: [
          { id: 't1', name: 'read_file', args: { path: 'a.ts' }, result: [{ text: 'hello' }] }
        ],
        tokens: { input: 10, output: 3, thoughts: 2, total: 15 }
      }
    ])
    expect(p.session.nativeSessionId).toBe('s-jsonl')
    expect(p.session.updatedAt).toBe('2026-06-01T01:00:00.000Z')
    expect(p.messages).toHaveLength(2)
    expect(p.messages[1]?.parts.map((p) => p.type)).toEqual([
      'text',
      'thinking',
      'tool-call',
      'tool-result',
      'usage'
    ])
    expect(p.session.metadata.tokens).toBe(15)
  })
  it('reads OpenCode real state.input, callID, modelID, patch and step events', () => {
    const p = parse('opencode', [
      {
        id: 'm1',
        role: 'assistant',
        modelID: 'model-1',
        parts: [
          { type: 'reasoning', text: 'plan' },
          {
            type: 'tool',
            tool: 'edit',
            callID: 'call-1',
            state: { input: { filePath: 'a.ts' }, status: 'completed', output: 'changed' }
          },
          { type: 'patch', files: ['a.ts'] },
          { type: 'step-finish', cost: 0.01, tokens: { input: 5, output: 2 } }
        ]
      }
    ])
    expect(p.messages[0]?.parts[1]).toMatchObject({
      type: 'tool-call',
      callId: 'call-1',
      name: 'edit'
    })
    expect(p.messages[0]?.parts[2]).toMatchObject({ type: 'tool-result', text: 'changed' })
    expect(p.session.warnings).toContain('NATIVE_EVENTS_RETAINED')
  })
  it('reads native Pi JSONL while retaining branch/compaction evidence and references', () => {
    const p = parse('pi', [
      {
        type: 'session',
        version: 3,
        id: 'pi-1',
        cwd: '/project',
        timestamp: '2026-10-01T00:00:00Z'
      },
      {
        type: 'message',
        id: 'u',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '继续' },
            { type: 'image', data: 'fixture', mimeType: 'image/png' }
          ]
        }
      },
      {
        type: 'message',
        id: 'a',
        message: {
          role: 'assistant',
          model: 'm',
          usage: { input: 10, output: 3, totalTokens: 13 },
          content: [{ type: 'toolCall', id: 't', name: 'read', arguments: { path: 'a.ts' } }]
        }
      },
      {
        type: 'message',
        id: 'r',
        message: { role: 'toolResult', toolCallId: 't', content: [{ type: 'text', text: 'done' }] }
      },
      { type: 'compaction', id: 'compact', summary: 'history context' }
    ])
    expect(p.session.nativeSessionId).toBe('pi-1')
    expect(p.messages[2]?.role).toBe('tool')
    expect(p.messages[3]?.sourceRef).toContain('#record=5')
    expect(p.session.metadata.tokens).toBe(13)
  })
  it('sorts dated messages stably and keeps native source references', () => {
    const p = parse('claude', [
      {
        type: 'assistant',
        uuid: 'a',
        timestamp: '2026-10-01T00:00:02Z',
        message: { role: 'assistant', content: 'answer' }
      },
      {
        type: 'user',
        uuid: 'u',
        timestamp: '2026-10-01T00:00:01Z',
        message: { role: 'user', content: 'question' }
      }
    ])
    expect(p.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(p.messages[0]?.sourceRef).toContain('#record=2')
  })
  it('does not merge different projects even when native ids coincide', () => {
    const a = parse('claude', [
      { type: 'user', sessionId: 'same', cwd: '/a', message: { role: 'user', content: 'task' } }
    ])
    const b = parse('claude', [
      { type: 'user', sessionId: 'same', cwd: '/b', message: { role: 'user', content: 'task' } }
    ])
    expect(a.session.id).not.toBe(b.session.id)
  })
  it('protects credential values and entire sensitive tool results before indexing', () => {
    const p = parse('claude', [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't', name: 'Read', input: { file_path: '.env' } }]
        }
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't',
              content: 'INTERNAL_REGION=private\nAPI_KEY=test-credential'
            }
          ]
        }
      }
    ])
    expect(JSON.stringify(p)).not.toContain('private')
    expect(JSON.stringify(p)).not.toContain('test-credential')
    expect(redact('Bearer abcdef\npassword=secret-value')).toContain('[REDACTED]')
    expect(redact('token=test-token-value')).not.toContain('test-token-value')
    expect(redact('Contents of .env:\n```text\nINTERNAL_HOST=private-host\n```')).not.toContain(
      'private-host'
    )
    expect(
      redact('-----BEGIN OPENSSH PRIVATE KEY-----\nsample\n-----END OPENSSH PRIVATE KEY-----')
    ).not.toContain('sample')
  })
  it('redacts sensitive results even when a tool call appears later in an out-of-order log', () => {
    const p = parse('claude', [
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't', content: 'INTERNAL_REGION=private-value' }
          ]
        }
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't', name: 'Read', input: { file_path: '.env.local' } }]
        }
      }
    ])
    expect(JSON.stringify(p)).not.toContain('private-value')
  })
  it('reports incompatible format revisions rather than indexing them as a supported conversation', () => {
    expect(() => parse('codex', [{ changed_schema: true }])).toThrow('SOURCE_FORMAT_ERROR')
    expect(
      serialized({ oauth: { customField: 'sensitive-value' }, access_token: 123 })
    ).not.toContain('sensitive-value')
    expect(JSON.parse(serialized({ oauth: { customField: 'sensitive-value' } }))).toEqual({
      oauth: '[REDACTED]'
    })
  })
})
