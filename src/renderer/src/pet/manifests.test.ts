import { describe, expect, it } from 'vitest'
import { PET_STATES } from '@shared/pet/types'
import { PET_MANIFESTS, PET_THEME_ORDER } from './manifests'

describe('built-in pet manifests', () => {
  it('ships the six original themes plus the starship cockpit skin', () => {
    expect(Object.keys(PET_MANIFESTS)).toHaveLength(7)
    expect(PET_THEME_ORDER.slice(0, 2)).toEqual(['maidWhite', 'office'])
    expect(PET_THEME_ORDER.at(-1)).toBe('starshipCockpit')
    expect(PET_MANIFESTS.maidWhite.priority).toBe(true)
    expect(PET_MANIFESTS.office.priority).toBe(true)
    expect(PET_MANIFESTS.starshipCockpit.priority).toBe(true)
  })

  it('defines every state directly for every priority theme', () => {
    for (const theme of [
      PET_MANIFESTS.maidWhite,
      PET_MANIFESTS.office,
      PET_MANIFESTS.starshipCockpit
    ]) {
      expect(Object.keys(theme.animations).sort()).toEqual([...PET_STATES].sort())
    }
  })

  it('uses valid single-cell sprite metadata for bundled RGBA assets', () => {
    for (const manifest of Object.values(PET_MANIFESTS)) {
      expect(manifest.sprite).toMatch(/(?:pico-.+|frost-navigator)\.png/)
      expect(manifest.frameWidth).toBeGreaterThan(0)
      expect(manifest.frameHeight).toBeGreaterThan(0)
      expect(manifest.columns).toBe(1)
      expect(manifest.rows).toBe(1)
      expect(manifest.animations.idle).toBeDefined()
    }
  })
})
