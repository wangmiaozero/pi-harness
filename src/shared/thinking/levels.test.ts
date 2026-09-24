import { describe, expect, it } from 'vitest'
import {
  getSupportedThinkingLevels,
  resolveCompactionThinkingLevel,
  resolveThinkingLevel
} from './levels'

describe('resolveThinkingLevel', () => {
  it('maps ultra to the highest supported Pi level', () => {
    expect(
      resolveThinkingLevel({ requested: 'ultra', supportedLevels: ['off', 'high', 'max'] })
    ).toBe('max')
    expect(
      resolveThinkingLevel({ requested: 'ultra', supportedLevels: ['off', 'medium', 'xhigh'] })
    ).toBe('xhigh')
    expect(resolveThinkingLevel({ requested: 'ultra', supportedLevels: ['off', 'high'] })).toBe(
      'high'
    )
  })

  it('keeps explicit Pi levels when the model supports them', () => {
    expect(resolveThinkingLevel({ requested: 'max', supportedLevels: ['max'] })).toBe('max')
    expect(resolveThinkingLevel({ requested: 'medium' })).toBe('medium')
  })

  it('clamps an unsupported request down to the model ceiling', () => {
    expect(resolveThinkingLevel({ requested: 'max', supportedLevels: ['off', 'high'] })).toBe(
      'high'
    )
  })
})

describe('getSupportedThinkingLevels', () => {
  it('reads non-empty thinkingLevelMap keys and ignores Ultra', () => {
    expect(
      getSupportedThinkingLevels({
        off: 'none',
        high: 'high',
        max: 'xhigh',
        ultra: 'ultra'
      })
    ).toEqual(['off', 'high', 'max'])
  })
})

describe('resolveCompactionThinkingLevel', () => {
  it('lowers high-effort chat thinking for compaction only', () => {
    expect(resolveCompactionThinkingLevel('ultra')).toBe('medium')
    expect(resolveCompactionThinkingLevel('max')).toBe('medium')
    expect(resolveCompactionThinkingLevel('xhigh')).toBe('medium')
    expect(resolveCompactionThinkingLevel('high')).toBe('medium')
    expect(resolveCompactionThinkingLevel('medium')).toBe('medium')
    expect(resolveCompactionThinkingLevel('low')).toBe('low')
    expect(resolveCompactionThinkingLevel('minimal')).toBe('minimal')
    expect(resolveCompactionThinkingLevel('off')).toBe('off')
  })
})
