import { describe, expect, it } from 'vitest'
import { COMPACTION_POLICY, evaluateCompactionNeed } from './compaction-policy'

describe('evaluateCompactionNeed', () => {
  it('never uses a token floor to block a session that exists', () => {
    const decision = evaluateCompactionNeed({
      sessionId: 'session-1',
      usage: { tokens: 1_200, contextWindow: 128_000 },
      messageCount: 2
    })
    expect(decision.canRun).toBe(true)
    expect(decision.reason).toBe('too-little-content')
    expect(decision.shouldCompact).toBe(false)
  })

  it('recommends compact at the policy ratios', () => {
    expect(
      evaluateCompactionNeed({
        sessionId: 'session-1',
        usage: { tokens: 90_000, contextWindow: 100_000 }
      }).reason
    ).toBe('context-high')
    expect(
      evaluateCompactionNeed({
        sessionId: 'session-1',
        usage: {
          tokens: COMPACTION_POLICY.suggestContextRatio * 100_000,
          contextWindow: 100_000
        }
      }).reason
    ).toBe('context-medium')
  })

  it('treats a busy compacting session as not runnable', () => {
    expect(
      evaluateCompactionNeed({
        sessionId: 'session-1',
        busy: 'compacting',
        usage: { tokens: 80_000, contextWindow: 100_000 }
      }).canRun
    ).toBe(false)
  })
})
