import { describe, expect, it } from 'vitest'
import {
  buildMessagePresentation,
  groupConversationTurns,
  type HistoryItem
} from './message-activity'
import type { AssistantContentBlock } from '@shared/types/workspace'

const assistant = (key: string, content: AssistantContentBlock[]): HistoryItem => ({
  key,
  entryId: key,
  message: { role: 'assistant', model: 'test', provider: 'test', content }
})
const call = (id = 'read-1'): AssistantContentBlock => ({
  type: 'toolCall',
  toolCallId: id,
  toolName: 'read',
  input: { path: 'example.ts' }
})
const result = (id = 'read-1'): HistoryItem => ({
  key: `result-${id}`,
  entryId: `result-${id}`,
  message: { role: 'toolResult', toolCallId: id, toolName: 'read', content: [] }
})

describe('message activity presentation', () => {
  it('groups consecutive activity, pairs results once, and preserves narrative boundaries', () => {
    const inputs = [
      assistant('intro', [{ type: 'text', text: 'I will inspect the files.' }]),
      assistant('tools', [{ type: 'thinking', thinking: 'Inspect first' }, call()]),
      result(),
      assistant('more-tools', [call('read-2')]),
      result('read-2'),
      assistant('reply', [{ type: 'text', text: 'Done.' }])
    ]
    const before = structuredClone(inputs)
    const view = buildMessagePresentation(inputs)
    expect(view.items.map((item) => item.type)).toEqual(['message', 'activity', 'message'])
    expect(view.items[1]).toMatchObject({ items: [{ key: 'tools' }, { key: 'more-tools' }] })
    expect(view.results.get('tools')?.get('read-1')).toEqual({
      message: result().message,
      entryId: 'result-read-1'
    })
    expect(view.pending.size).toBe(0)
    expect(inputs).toEqual(before)
  })

  it('separates mixed commentary and tools in order, with each result attached once', () => {
    const item = assistant('mixed', [{ type: 'text', text: 'Checking.' }, call()])
    const view = buildMessagePresentation([item, result()])
    expect(view.items.map((item) => item.type)).toEqual(['message', 'activity'])
    expect(view.items[0]).toMatchObject({
      key: 'mixed',
      item: { message: { content: [{ type: 'text', text: 'Checking.' }] } }
    })
    expect(view.results.get('mixed:activity-1')?.get('read-1')?.message).toEqual(result().message)
  })

  it('never pairs reused tool ids across user turns and retains orphan results', () => {
    const view = buildMessagePresentation([
      assistant('old', [call()]),
      { key: 'user', message: { role: 'user', content: 'New turn' } },
      result()
    ])
    expect(view.results.size).toBe(0)
    expect(view.items.at(-1)).toMatchObject({ type: 'activity', items: [{ key: 'result-read-1' }] })
    expect(view.pending.size).toBe(0)
  })

  it('keeps errors, file changes and images out of collapsed activity groups', () => {
    const error = {
      ...assistant('error', [call()]),
      message: { ...assistant('error', [call()]).message, errorMessage: 'API failed' }
    } as HistoryItem
    const images = assistant('image', [{ type: 'image', data: 'TQ==', mimeType: 'image/png' }])
    const changes: HistoryItem = {
      ...assistant('changes', [call()]),
      fileChanges: { runId: 'run', status: 'verified', files: [], additions: 0, deletions: 0 }
    }
    const view = buildMessagePresentation([error, images, changes])
    const narrative = view.items.filter((item) => item.type === 'message')
    expect(narrative).toHaveLength(3)
    expect(narrative[0]).toMatchObject({ item: { message: { errorMessage: 'API failed' } } })
    expect(narrative[2]).toMatchObject({ item: { fileChanges: changes.fileChanges } })
  })
})

it('merges assistant fragments and activity into one response per user message', () => {
  const input: HistoryItem[] = [
    { key: 'user-1', message: { role: 'user', content: 'Check this' } },
    assistant('intro', [{ type: 'text', text: 'Checking.' }]),
    assistant('call', [call()]),
    result(),
    assistant('done', [{ type: 'text', text: 'Done.' }]),
    { key: 'user-2', message: { role: 'user', content: 'Continue' } },
    assistant('next', [{ type: 'text', text: 'Continuing.' }])
  ]
  const turns = groupConversationTurns(buildMessagePresentation(input).items)
  expect(turns.map((item) => item.type)).toEqual(['message', 'turn', 'message', 'turn'])
  expect(turns[1]).toMatchObject({
    text: 'Checking.\n\nDone.',
    items: [{ type: 'message' }, { type: 'activity' }, { type: 'message' }]
  })
  expect(turns[3]).toMatchObject({ text: 'Continuing.' })
})
