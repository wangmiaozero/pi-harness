import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SMART_COMPACTION,
  normalizeSmartCompaction,
  smartCompactionThreshold
} from './smart-compaction'

describe('smartCompactionThreshold', () => {
  it('scales per model window: 128K vs 1M get different early thresholds', () => {
    const settings = DEFAULT_SMART_COMPACTION
    expect(
      smartCompactionThreshold({
        contextWindow: 128_000,
        reserveTokens: 16_384,
        settings
      })
    ).toBe(102_400)
    expect(
      smartCompactionThreshold({
        contextWindow: 1_050_000,
        reserveTokens: 16_384,
        settings
      })
    ).toBe(256_000)
  })

  it('never schedules later than Pi native reserveTokens', () => {
    expect(
      smartCompactionThreshold({
        contextWindow: 128_000,
        reserveTokens: 60_000,
        settings: { enabled: true, ratio: 0.9, maxTokens: 1_000_000 }
      })
    ).toBe(68_000)
  })

  it('degrades to unknown when the window is missing', () => {
    expect(
      smartCompactionThreshold({
        contextWindow: null,
        reserveTokens: 16_384,
        settings: DEFAULT_SMART_COMPACTION
      })
    ).toBeNull()
  })
})

describe('normalizeSmartCompaction', () => {
  it('keeps defaults for unknown or incomplete settings', () => {
    expect(normalizeSmartCompaction(undefined)).toEqual(DEFAULT_SMART_COMPACTION)
    expect(normalizeSmartCompaction({ enabled: false, ratio: 0.55, maxTokens: 1 })).toEqual({
      enabled: false,
      ratio: DEFAULT_SMART_COMPACTION.ratio,
      maxTokens: DEFAULT_SMART_COMPACTION.maxTokens
    })
  })
})
