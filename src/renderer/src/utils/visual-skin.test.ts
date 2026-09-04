import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme } from './theme'
import { applyVisualSkin, getActiveVisualSkin, isStarshipCockpitActive } from './visual-skin'
import { VISUAL_SKINS } from './skin-catalog'

const activeSettings = {
  mascotStyle: 'starshipCockpit' as const,
  mascotUnlocked: true,
  petEnabled: true
}

afterEach(() => {
  delete document.documentElement.dataset.visualSkin
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.appearance
  document.documentElement.style.colorScheme = ''
})

describe('visual skin transitions', () => {
  for (const mascotStyle of Object.keys(VISUAL_SKINS) as (keyof typeof VISUAL_SKINS)[]) {
    it(`applies ${mascotStyle}, respects locking/visibility, and restores the saved palette`, () => {
      const settings = { ...activeSettings, mascotStyle }
      const skin = VISUAL_SKINS[mascotStyle]
      applyVisualSkin(settings)
      applyTheme('pink')
      expect(document.documentElement.dataset.visualSkin).toBe(skin.id)
      expect(document.documentElement.dataset.theme).toBe(skin.appearance)
      expect(document.documentElement.dataset.appearance).toBe(skin.appearance)
      expect(document.documentElement.style.colorScheme).toBe(skin.appearance)
      expect(getActiveVisualSkin({ ...settings, mascotUnlocked: false })).toBeUndefined()
      expect(getActiveVisualSkin({ ...settings, petEnabled: false })).toBeUndefined()
      applyVisualSkin({ ...settings, petEnabled: false })
      applyTheme('pink')
      expect(document.documentElement.dataset.visualSkin).toBeUndefined()
      expect(document.documentElement.dataset.theme).toBe('pink')
    })
  }

  it('switches directly between light and dark skins without retaining the old identity', () => {
    for (const mascotStyle of ['moonlitMaid', 'noirScholar', 'starshipCockpit'] as const) {
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

  it('lets maidWhite and office borrow the cockpit and noir study skins', () => {
    applyVisualSkin({ ...activeSettings, mascotStyle: 'maidWhite' })
    applyTheme('light')
    expect(document.documentElement.dataset.visualSkin).toBe('starship-cockpit')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(isStarshipCockpitActive({ ...activeSettings, mascotStyle: 'maidWhite' })).toBe(true)

    applyVisualSkin({ ...activeSettings, mascotStyle: 'office' })
    applyTheme('light')
    expect(document.documentElement.dataset.visualSkin).toBe('noir-scholar')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(isStarshipCockpitActive({ ...activeSettings, mascotStyle: 'office' })).toBe(false)
  })
})

describe('starship cockpit visual skin', () => {
  it('activates only for the enabled and unlocked special mascot', () => {
    expect(isStarshipCockpitActive(activeSettings)).toBe(true)
    expect(isStarshipCockpitActive({ ...activeSettings, petEnabled: false })).toBe(false)
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
