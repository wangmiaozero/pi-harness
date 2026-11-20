import { describe, expect, it, vi } from 'vitest'
import { SmartCompactionGate } from './smart-compaction-gate'
import type { SmartCompactionSettings } from '@shared/workspace/smart-compaction'

function settings(overrides: Partial<SmartCompactionSettings> = {}) {
  return {
    enabled: true,
    ratio: 0.8,
    maxTokens: 256_000,
    ...overrides
  }
}

describe('SmartCompactionGate', () => {
  it('compacts with the current model before the next prompt, then lets work continue', async () => {
    const gate = new SmartCompactionGate(() => settings())
    const compact = vi.fn().mockResolvedValue({
      tokensBefore: 90_000,
      estimatedTokensAfter: 12_000
    })
    const emit = vi.fn()
    await gate.beforePrompt('s1', {
      read: async () => ({
        usage: { tokens: 90_000, contextWindow: 100_000 },
        autoEnabled: true,
        reserveTokens: 16_384,
        idle: true
      }),
      compact,
      emit
    })
    expect(compact).toHaveBeenCalledOnce()
    expect(emit.mock.calls.map((call) => call[0].type)).toEqual([
      'smart_compaction_start',
      'smart_compaction_end'
    ])
    // Pi's own compaction_* events update status; smart_* only marks the gate.
    gate.observe('s1', { type: 'compaction_start', reason: 'manual' })
    gate.observe('s1', {
      type: 'compaction_end',
      reason: 'manual',
      result: { tokensBefore: 90_000, estimatedTokensAfter: 12_000 }
    })
    expect(
      gate.status('s1', {
        usage: { tokens: 12_000, contextWindow: 100_000 },
        autoEnabled: true,
        reserveTokens: 16_384
      })
    ).toMatchObject({
      smartEnabled: true,
      phase: 'succeeded',
      trigger: 'smart',
      tokensBefore: 90_000,
      tokensAfter: 12_000,
      threshold: 80_000
    })
  })

  it('skips when usage is unknown, below threshold, smart disabled, or auto-compaction off', async () => {
    const gate = new SmartCompactionGate(() => settings({ enabled: false }))
    const compact = vi.fn()
    const probe = {
      read: async () => ({
        usage: { tokens: 90_000, contextWindow: 100_000 },
        autoEnabled: true,
        idle: true
      }),
      compact,
      emit: vi.fn()
    }
    await gate.beforePrompt('s1', probe)
    gate.configure(() => settings())
    await gate.beforePrompt('s1', {
      ...probe,
      read: async () => ({
        usage: { tokens: null, contextWindow: 100_000 },
        autoEnabled: true,
        idle: true
      })
    })
    await gate.beforePrompt('s1', {
      ...probe,
      read: async () => ({
        usage: { tokens: 10_000, contextWindow: 100_000 },
        autoEnabled: true,
        idle: true
      })
    })
    await gate.beforePrompt('s1', {
      ...probe,
      read: async () => ({
        usage: { tokens: 90_000, contextWindow: 100_000 },
        autoEnabled: false,
        idle: true
      })
    })
    expect(compact).not.toHaveBeenCalled()
  })

  it('single-flights concurrent prompts and cools down after a rate-limit failure', async () => {
    const gate = new SmartCompactionGate(() => settings(), () => 1_000)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const compact = vi.fn(async () => {
      await held
      return { tokensBefore: 90_000, estimatedTokensAfter: 20_000 }
    })
    const probe = {
      read: async () => ({
        usage: { tokens: 90_000, contextWindow: 100_000 },
        autoEnabled: true,
        idle: true
      }),
      compact,
      emit: vi.fn()
    }
    const first = gate.beforePrompt('s1', probe)
    await expect.poll(() => compact.mock.calls.length).toBe(1)
    const second = gate.beforePrompt('s1', probe)
    release()
    await Promise.all([first, second])
    expect(compact).toHaveBeenCalledOnce()

    const failing = new SmartCompactionGate(() => settings(), () => 5_000)
    await failing.beforePrompt('s2', {
      ...probe,
      compact: vi.fn().mockRejectedValue(
        new Error(
          '429 Rate limit reached for gpt-6.2-sol on tokens per min (TPM). Please try again in 4.85s.'
        )
      )
    })
    const status = failing.status('s2', {
      usage: { tokens: 90_000, contextWindow: 100_000 },
      autoEnabled: true
    })
    expect(status?.phase).toBe('failed')
    expect(status?.errorKind).toBe('rate_limit')
    expect(status?.retryAt).toBeGreaterThan(5_000)
    const compactAgain = vi.fn()
    await failing.beforePrompt('s2', { ...probe, compact: compactAgain })
    expect(compactAgain).not.toHaveBeenCalled()
  })

  it('cools down after failures, then keeps compacting so long sessions never stall', async () => {
    let now = 0
    const gate = new SmartCompactionGate(() => settings(), () => now)
    const compact = vi.fn().mockRejectedValue(new Error('Fixture summarization unavailable'))
    const probe = {
      read: async () => ({
        usage: { tokens: 90_000, contextWindow: 100_000 },
        autoEnabled: true,
        idle: true
      }),
      compact,
      emit: vi.fn()
    }
    await gate.beforePrompt('s1', probe)
    expect(compact).toHaveBeenCalledTimes(1)
    await gate.beforePrompt('s1', probe)
    expect(compact).toHaveBeenCalledTimes(1)
    now = gate.status('s1', {
      usage: { tokens: 90_000, contextWindow: 100_000 },
      autoEnabled: true
    })!.retryAt!
    for (let i = 0; i < 3; i++) {
      await gate.beforePrompt('s1', probe)
      now = Math.max(
        now + 1,
        gate.status('s1', {
          usage: { tokens: 90_000, contextWindow: 100_000 },
          autoEnabled: true
        })?.retryAt ?? now
      )
    }
    expect(compact.mock.calls.length).toBeGreaterThanOrEqual(4)
  })
})
