import { describe, expect, it } from 'vitest'
import { parseSession, hash } from './parsers'
import { retainRecordEvidence } from './evidence'
import { migrateSessionNormalization } from '@shared/universal/evidence-schema'
import { universalSessionSchema, sessionHandoffSchema } from '@shared/universal/schema'

const parse = (records: unknown[]) =>
  parseSession({
    provider: 'claude',
    records,
    file: '/fixtures/log.jsonl',
    root: '/fixtures',
    fingerprint: hash('fixture'),
    mtime: '2026-10-15T00:00:00.000Z'
  })
describe('source-backed task normalization', () => {
  it('uses a new evidence blob for metadata-only source changes', () => {
    const message = { type: 'user', uuid: 'u', message: { role: 'user', content: 'Task' } }
    const first = parse([{ type: 'session', id: 'source', git: { branch: 'main' } }, message])
    const second = parse([{ type: 'session', id: 'source', git: { branch: 'topic' } }, message])
    expect(first.messages).toEqual(second.messages)
    expect(first.session.blob).not.toBe(second.session.blob)
    expect(first.session.normalization?.gitContext.branch).toBe('main')
    expect(second.session.normalization?.gitContext.branch).toBe('topic')
  })
  it('retains native evidence and correlates tool outcomes without declaring current changes verified', () => {
    const records = [
      {
        type: 'user',
        uuid: 'user',
        message: { role: 'user', content: 'Fix the service. Next step: run tests.' }
      },
      {
        type: 'assistant',
        uuid: 'call',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'write-1',
              name: 'Write',
              input: { file_path: 'src/service.ts', content: 'export const fixed = true' }
            }
          ]
        }
      },
      {
        type: 'user',
        uuid: 'result',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'write-1', content: 'written' }]
        }
      },
      {
        type: 'assistant',
        uuid: 'claim',
        message: { role: 'assistant', content: 'Implemented the service. Tests not yet run.' }
      }
    ]
    const before = JSON.stringify(records)
    const first = parse(records)
    const second = parse(records)
    expect(JSON.stringify(records)).toBe(before)
    expect(first.session.blob).toBe(second.session.blob)
    expect(first.evidence).toHaveLength(4)
    expect(first.messages[1].provenance?.recordDigest).toBe(first.evidence?.[1].recordDigest)
    expect(first.messages[1].toolInvocations).toMatchObject([
      {
        callId: 'write-1',
        status: 'result-recorded',
        resultEvidence: ['/fixtures/log.jsonl#record=3']
      }
    ])
    expect(first.messages[1].fileChanges).toMatchObject([
      {
        path: 'src/service.ts',
        kind: 'write',
        status: 'result-recorded',
        currentVerified: false,
        diff: null
      }
    ])
    expect(first.session.normalization?.taskState.currentVerified).toBe(false)
    expect(first.session.normalization?.capabilities.gitContext).toBe('unknown')
    expect(first.session.normalization?.gitContext).toEqual({
      branch: null,
      commit: null,
      worktree: null
    })
    expect(first.messages.map((message) => message.sequence)).toEqual([0, 1, 2, 3])
  })
  it('keeps ambiguous IDs and missing results unknown instead of joining unrelated executions', () => {
    const call = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'reused', name: 'Write', input: { path: 'a' } }]
      }
    }
    const result = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'reused', content: 'ok' }]
      }
    }
    const parsed = parse([call, call, result])
    expect(parsed.messages[0].toolInvocations?.[0].status).toBe('unknown')
    expect(parsed.session.normalization?.diagnostics).toContain('AMBIGUOUS_OR_MISSING_CALL_ID')
  })
  it('retains a recorded Pi edit diff without treating it as a current verified change', () => {
    const parsed = parseSession({
      provider: 'pi',
      file: '/fixtures/pi.jsonl',
      root: '/fixtures',
      fingerprint: hash('pi'),
      mtime: '2026-10-15T00:00:00.000Z',
      records: [
        { type: 'session', id: 'pi', cwd: '/fixture/project' },
        {
          type: 'message',
          id: 'call',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'edit-1',
                name: 'edit',
                arguments: { path: 'a.ts', oldText: 'old', newText: 'new' }
              }
            ]
          }
        },
        {
          type: 'message',
          id: 'result',
          message: {
            role: 'toolResult',
            toolCallId: 'edit-1',
            content: [{ type: 'text', text: 'edited' }],
            details: { diff: '@@ -1 +1 @@\n-old\n+new' }
          }
        }
      ]
    })
    expect(parsed.messages[0].fileChanges).toMatchObject([
      {
        path: 'a.ts',
        diff: '@@ -1 +1 @@\n-old\n+new',
        diffTruncated: false,
        currentVerified: false
      }
    ])
  })
  it('marks bounded evidence retention and task sampling explicitly', () => {
    const evidence = retainRecordEvidence([{ text: 'x'.repeat(100_000) }], '/fixture')
    expect(evidence[0].truncated).toBe(true)
    expect(evidence[0].record.length).toBeLessThanOrEqual(32_000)
    const parsed = parse(
      Array.from({ length: 210 }, (_, index) => ({
        type: 'user',
        uuid: String(index),
        message: { role: 'user', content: `Request ${index}` }
      }))
    )
    expect(parsed.session.normalization?.taskState).toMatchObject({
      partial: true,
      analyzedMessages: 200,
      totalMessages: 210
    })
  })
  it('reads legacy metadata without claiming enrichment and rejects unknown versions', () => {
    const current = parse([{ type: 'user', message: { role: 'user', content: 'Task' } }]).session
    const { normalization: _metadata, ...legacy } = current
    expect(universalSessionSchema.parse(legacy).normalization).toBeUndefined()
    expect(migrateSessionNormalization(undefined)).toBeNull()
    expect(() => migrateSessionNormalization({ schemaVersion: 999 })).toThrow()
    expect(sessionHandoffSchema.shape.sourceNormalization.isOptional()).toBe(true)
  })
})
