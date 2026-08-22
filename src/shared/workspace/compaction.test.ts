import { describe, expect, it } from 'vitest'
import type { AgentMessage, AgentStateSnapshot } from '../types/workspace'
import { canCompactSession } from './compaction'

const state = (tokens: number): AgentStateSnapshot => ({
  sessionId: 'session',
  sessionFile: '/tmp/session.jsonl',
  status: 'idle',
  isStreaming: false,
  isPromptRunning: false,
  isBashRunning: false,
  isCompacting: false,
  autoCompactionEnabled: true,
  thinkingLevel: 'off',
  contextUsage: { percent: 0.2, contextWindow: 128_000, tokens },
  pendingMessageCount: 0,
  queuedMessages: { steering: [], followUp: [] }
})

const user = (text: string): AgentMessage => ({ role: 'user', content: text })
const assistant: AgentMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'ok' }],
  model: 'model',
  provider: 'provider'
}

describe('manual compaction availability', () => {
  it('rejects short and single-turn sessions', () => {
    expect(canCompactSession([user('one'), assistant], state(40_000))).toBe(false)
    expect(canCompactSession([user('one'), assistant, user('two'), assistant], state(10_000))).toBe(
      false
    )
  })

  it('allows an idle multi-turn session with enough context', () => {
    expect(canCompactSession([user('one'), assistant, user('two'), assistant], state(40_000))).toBe(
      true
    )
  })

  it('rejects a session while the agent is busy', () => {
    expect(
      canCompactSession([user('one'), assistant, user('two'), assistant], state(40_000), true)
    ).toBe(false)
  })
})
