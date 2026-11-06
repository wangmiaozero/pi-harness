import { describe, expect, it } from 'vitest'
import { PET_STATES } from '@shared/pet/types'
import { resolveMascotStyle } from '@shared/constants/mascot'
import { PET_MANIFESTS, PET_THEME_ORDER } from './manifests'

describe('built-in pet manifests', () => {
  it('ships eighteen independent built-in themes', () => {
    expect(Object.keys(PET_MANIFESTS)).toHaveLength(18)
    expect(PET_THEME_ORDER).toEqual([
      'maidWhite',
      'office',
      'starshipCockpit',
      'noirScholar',
      'moonlitMaid',
      'mingSnow',
      'zhangJuzhengSnow',
      'mingMoon',
      'ropeWhale',
      'ropePhoebe',
      'ropeClaude',
      'ropeDeepseek',
      'ropeGemini',
      'ropeGpt',
      'ropeGlm',
      'ropeGrok',
      'ropeKimi',
      'ropeQwen'
    ])
    expect(PET_MANIFESTS.maidWhite.priority).toBe(true)
    expect(PET_MANIFESTS.office.priority).toBe(true)
    expect(PET_MANIFESTS.starshipCockpit.priority).toBe(true)
  })

  it('keeps the maidWhite and office characters on their own scene skins', () => {
    expect(PET_MANIFESTS.maidWhite.sprite).toMatch(/pico-maid-white\.png$/)
    expect(PET_MANIFESTS.office.sprite).toMatch(/pico-office\.png$/)
    expect(resolveMascotStyle('maidWhite')).toBe('maidWhite')
    expect(resolveMascotStyle('office')).toBe('office')
  })

  it('defines every state directly for every priority theme', () => {
    for (const theme of Object.values(PET_MANIFESTS)) {
      expect(Object.keys(theme.animations).sort()).toEqual([...PET_STATES].sort())
    }
  })

  it('uses valid single-cell sprite metadata for bundled RGBA assets', () => {
    for (const manifest of Object.values(PET_MANIFESTS)) {
      expect(manifest.sprite).toMatch(/\.png$/)
      expect(manifest.frameWidth).toBeGreaterThan(0)
      expect(manifest.frameHeight).toBeGreaterThan(0)
      expect(manifest.columns).toBe(1)
      expect(manifest.rows).toBe(1)
      expect(manifest.animations.idle).toBeDefined()
    }
  })

  it('keeps the wallpaper engine portrait at its source size', () => {
    expect(PET_MANIFESTS.ropeDeepseek.frameWidth).toBe(330)
    expect(PET_MANIFESTS.ropeDeepseek.frameHeight).toBe(384)
    expect(PET_MANIFESTS.ropeDeepseek.sprite).toMatch(/rope\/deepseek\.png$/)
    expect(PET_MANIFESTS.ropeWhale.frameWidth).toBe(384)
    expect(PET_MANIFESTS.ropeWhale.frameHeight).toBe(576)
    expect(PET_MANIFESTS.ropeWhale.sprite).toMatch(/rope\/whale\.png$/)
  })
})
