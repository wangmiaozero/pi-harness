import { describe, expect, it } from 'vitest'
import { PET_STATES } from '@shared/pet/types'
import { PET_MANIFESTS, PET_THEME_ORDER } from './manifests'

describe('built-in pet manifests', () => {
  it('ships exactly six themes with requested priority order', () => {
    expect(Object.keys(PET_MANIFESTS)).toHaveLength(6)
    expect(PET_THEME_ORDER.slice(0, 2)).toEqual(['maidWhite', 'office'])
    expect(PET_MANIFESTS.maidWhite.priority).toBe(true)
    expect(PET_MANIFESTS.office.priority).toBe(true)
  })

  it('defines every state directly for both priority themes', () => {
    for (const theme of [PET_MANIFESTS.maidWhite, PET_MANIFESTS.office]) {
      expect(Object.keys(theme.animations).sort()).toEqual([...PET_STATES].sort())
    }
  })

  it('uses valid single-cell sprite metadata for bundled RGBA assets', () => {
    for (const manifest of Object.values(PET_MANIFESTS)) {
      expect(manifest.sprite).toMatch(/pico-.+\.png/)
      expect(manifest.frameWidth).toBe(1024)
      expect(manifest.frameHeight).toBe(1536)
      expect(manifest.columns).toBe(1)
      expect(manifest.rows).toBe(1)
      expect(manifest.animations.idle).toBeDefined()
    }
  })
})
