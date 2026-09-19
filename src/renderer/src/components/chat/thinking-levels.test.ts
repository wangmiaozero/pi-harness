import { describe, expect, it } from 'vitest'
import {
  COMPOSER_THINKING_LEVELS,
  clampThinkingLevel,
  composerThinkingLevels,
  resolveAvailableThinkingLevels,
  thinkingEffectState,
  thinkingIndex,
  thinkingLabelKey,
  thinkingLevelAt
} from './thinking-levels'

describe('composer thinking levels', () => {
  it('starts at auto and ends at Codex-style ultra in the full catalog', () => {
    expect(COMPOSER_THINKING_LEVELS[0]).toBe('auto')
    expect(COMPOSER_THINKING_LEVELS.at(-1)).toBe('ultra')
  })

  it('keeps Ultra on the slider even when a model only maps Pi levels', () => {
    expect(composerThinkingLevels(resolveAvailableThinkingLevels(null))).toEqual([
      'auto',
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra'
    ])
    expect(
      composerThinkingLevels(
        resolveAvailableThinkingLevels({
          off: 'off',
          low: 'low',
          high: 'high'
        })
      )
    ).toEqual(['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
  })

  it('maps unknown values to a mid stop and clamps to the current rail', () => {
    const levels = composerThinkingLevels(null)
    expect(thinkingIndex('nope', levels)).toBe(thinkingIndex('medium', levels))
    expect(thinkingLevelAt(-3, levels)).toBe('auto')
    expect(thinkingLevelAt(99, levels)).toBe('ultra')
    expect(clampThinkingLevel('max', levels)).toBe('max')
    expect(clampThinkingLevel('high', levels)).toBe('high')
  })

  it('builds i18n keys', () => {
    expect(thinkingLabelKey('auto')).toBe('workspace.thinkingAuto')
    expect(thinkingLabelKey('none')).toBe('workspace.thinkingNone')
    expect(thinkingLabelKey('xhigh')).toBe('workspace.thinkingXhigh')
    expect(thinkingLabelKey('ultra')).toBe('workspace.thinkingUltra')
  })

  it('ignites the effect at medium and peaks on the last stop', () => {
    const levels = composerThinkingLevels(null)
    expect(thinkingEffectState('low', levels)).toMatchObject({ ignited: false, max: false, power: 0 })
    expect(thinkingEffectState('medium', levels).ignited).toBe(true)
    expect(thinkingEffectState('medium', levels).max).toBe(false)
    expect(thinkingEffectState('medium', levels).power).toBeGreaterThan(0)
    expect(thinkingEffectState('medium', levels).power).toBeLessThan(1)
    expect(thinkingEffectState('high', levels)).toMatchObject({ ignited: true, max: false })
    expect(thinkingEffectState('max', levels)).toMatchObject({ ignited: true, max: true, power: 1 })
    expect(thinkingEffectState('ultra', levels)).toMatchObject({ ignited: true, max: true, power: 1 })
  })
})
