import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme } from './theme'
import { applyVisualSkin, getActiveVisualSkin, isStarshipCockpitActive } from './visual-skin'
import { VISUAL_SKINS } from './skin-catalog'

const activeSettings = {
  mascotStyle: 'starshipCockpit' as const,
  mascotUnlocked: true
}

afterEach(() => {
  delete document.documentElement.dataset.visualSkin
  delete document.documentElement.dataset.portraitSkin
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.appearance
  document.documentElement.style.colorScheme = ''
})

describe('visual skin transitions', () => {
  for (const mascotStyle of Object.keys(VISUAL_SKINS) as (keyof typeof VISUAL_SKINS)[]) {
    it(`applies ${mascotStyle}, respects locking/theme selection, and restores the saved palette`, () => {
      const settings = { ...activeSettings, mascotStyle }
      const skin = VISUAL_SKINS[mascotStyle]
      applyVisualSkin(settings)
      applyTheme('pink')
      expect(document.documentElement.dataset.visualSkin).toBe(skin.id)
      expect(document.documentElement.dataset.portraitSkin).toBe(String(skin.portrait))
      expect(document.documentElement.dataset.theme).toBe(skin.appearance)
      expect(document.documentElement.dataset.appearance).toBe(skin.appearance)
      expect(document.documentElement.style.colorScheme).toBe(skin.appearance)
      expect(getActiveVisualSkin({ ...settings, mascotUnlocked: false })).toBeUndefined()
      applyVisualSkin({ ...settings, mascotStyle: 'none' })
      applyTheme('pink')
      expect(document.documentElement.dataset.visualSkin).toBeUndefined()
      expect(document.documentElement.dataset.portraitSkin).toBeUndefined()
      expect(document.documentElement.dataset.theme).toBe('pink')
    })
  }

  it('switches directly between light and dark skins without retaining the old identity', () => {
    for (const mascotStyle of [
      'maidWhite',
      'office',
      'moonlitMaid',
      'noirScholar',
      'starshipCockpit'
    ] as const) {
      applyVisualSkin({ ...activeSettings, mascotStyle })
      applyTheme('green')
      expect(document.documentElement.dataset.visualSkin).toBe(VISUAL_SKINS[mascotStyle].id)
      expect(document.documentElement.style.colorScheme).toBe(VISUAL_SKINS[mascotStyle].appearance)
    }
    applyVisualSkin(null)
    applyTheme('green')
    expect(document.documentElement.dataset.visualSkin).toBeUndefined()
    expect(document.documentElement.dataset.theme).toBe('green')
  })

  it('keeps maidWhite and office on independent portrait skins', () => {
    applyVisualSkin({ ...activeSettings, mascotStyle: 'maidWhite' })
    applyTheme('dark')
    expect(document.documentElement.dataset.visualSkin).toBe('maid-white')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(isStarshipCockpitActive({ ...activeSettings, mascotStyle: 'maidWhite' })).toBe(false)

    applyVisualSkin({ ...activeSettings, mascotStyle: 'office' })
    applyTheme('light')
    expect(document.documentElement.dataset.visualSkin).toBe('office-executive')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(isStarshipCockpitActive({ ...activeSettings, mascotStyle: 'office' })).toBe(false)
  })
})

describe('starship cockpit visual skin', () => {
  it('activates only for the unlocked starship theme', () => {
    expect(isStarshipCockpitActive(activeSettings)).toBe(true)
    expect(isStarshipCockpitActive({ ...activeSettings, mascotUnlocked: false })).toBe(false)
    expect(isStarshipCockpitActive({ ...activeSettings, mascotStyle: 'office' })).toBe(false)
  })

  it('pins appearance to dark so light/dark preference cannot restyle the cockpit', () => {
    applyVisualSkin(activeSettings)
    applyTheme('light')

    expect(document.documentElement.dataset.visualSkin).toBe('starship-cockpit')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.appearance).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    applyVisualSkin({ ...activeSettings, mascotStyle: 'moonlitMaid' })
    applyTheme('light')

    expect(document.documentElement.dataset.visualSkin).toBe('moonlit-maid')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.appearance).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
