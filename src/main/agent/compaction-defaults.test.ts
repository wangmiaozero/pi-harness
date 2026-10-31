import { describe, expect, it } from 'vitest'
import { compactionDefaults } from './compaction-defaults'

describe('compaction channel limits', () => {
  it('resolves the Coding Plan limits without changing the supplied chat model', () => {
    const model = { provider: 'ark-code', id: 'kimi-k3.1-pro', maxTokens: 4096 }
    expect(compactionDefaults(model)).toMatchObject({
      maxOutputTokens: 1048576,
      reasoning: true,
      thinkingLevels: { off: null, low: 'low' },
      forceEffort: true
    })
    expect(model.maxTokens).toBe(4096)
  })
  it.each([
    null,
    { provider: 'ark-code', id: 'unknown-model' },
    { provider: 'moonshot', id: 'kimi-k3.1-pro' },
    { provider: 'openai-compatible', id: 'gpt-6-astra' },
    { provider: 'private-relay', id: 'gpt-6-astra' }
  ])('does not invent an output allowance for %j', (model) => {
    expect(compactionDefaults(model)).toBeUndefined()
  })
})
