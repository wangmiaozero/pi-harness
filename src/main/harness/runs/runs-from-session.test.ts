import { expect, it } from 'vitest'
import type { SessionEntry } from '@shared/types/workspace'
import { buildRunsFromEntries } from './runs-from-session'

it('ends reconstructed durations at the last reply, excluding idle time before another prompt', () => {
  const entries = [
    {
      id: 'u1',
      type: 'message',
      parentId: null,
      timestamp: '2026-11-03T00:00:00Z',
      message: { role: 'user', content: 'one' }
    },
    {
      id: 'a1',
      type: 'message',
      parentId: null,
      timestamp: '2026-11-03T00:00:03Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
    },
    {
      id: 'u2',
      type: 'message',
      parentId: null,
      timestamp: '2026-11-03T03:00:00Z',
      message: { role: 'user', content: 'two' }
    },
    {
      id: 'a2',
      type: 'message',
      parentId: null,
      timestamp: '2026-11-03T03:00:01Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
    }
  ] as SessionEntry[]
  expect(buildRunsFromEntries(entries).map(({ run }) => run.finishedAt! - run.startedAt)).toEqual([
    3000, 1000
  ])
  expect(buildRunsFromEntries(entries.slice(0, 1))[0].run.finishedAt).toBeNull()
})
