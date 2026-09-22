import { describe, expect, it } from 'vitest'
import { MASCOT_STYLES } from '@shared/constants/mascot'
import { particleOrigin, resolveStartupVariant, STARTUP_PALETTES } from './startup-variants'

describe('startup quantum variants', () => {
  it('uses the current animation without an unlocked theme', () => {
    expect(resolveStartupVariant(null)).toBe('none')
    expect(resolveStartupVariant({ mascotStyle: 'mingSnow', mascotUnlocked: false })).toBe('none')
    expect(resolveStartupVariant({ mascotStyle: 'mingSnow', mascotUnlocked: true }, false)).toBe(
      'none'
    )
  })

  it('uses one particle color for the default quantum animation', () => {
    const palette = STARTUP_PALETTES.none
    expect(
      new Set([palette.accent, palette.secondary, palette.tertiary, ...palette.particles])
    ).toEqual(new Set([palette.accent]))
  })

  it('covers all seven unlocked themes with distinct colors and trajectories', () => {
    const themed = MASCOT_STYLES.filter((style) => style !== 'none')
    expect(themed).toHaveLength(7)
    expect(new Set(themed.map((style) => STARTUP_PALETTES[style].background)).size).toBe(7)
    const origins = themed.map((style) => {
      expect(resolveStartupVariant({ mascotStyle: style, mascotUnlocked: true })).toBe(style)
      return particleOrigin(style, 15, 100, 1200, 800, 0.35, 0.6)
    })
    expect(new Set(origins.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)).size).toBe(7)
  })
})
