import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme } from './theme'
import { applyVisualSkin, getActiveVisualSkin, isStarshipCockpitActive } from './visual-skin'
import { setCustomSkinCatalog, VISUAL_SKINS } from './skin-catalog'

const activeSettings = {
  mascotStyle: 'starshipCockpit' as const,
  mascotUnlocked: true
}

afterEach(() => {
  delete document.documentElement.dataset.visualSkin
  delete document.documentElement.dataset.portraitSkin
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.appearance
  delete document.documentElement.dataset.customSkin
  document.documentElement.removeAttribute('style')
  setCustomSkinCatalog([])
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
      'mingSnow',
      'zhangJuzhengSnow',
      'mingMoon',
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

  it('keeps both macOS 27 variants isolated from visual skins and restores them afterward', () => {
    for (const [theme, appearance] of [
      ['macos27-light', 'light'],
      ['macos27', 'dark']
    ] as const) {
      applyTheme(theme)
      expect(document.documentElement.dataset.theme).toBe(theme)
      expect(document.documentElement.dataset.appearance).toBe(appearance)

      applyVisualSkin({ ...activeSettings, mascotStyle: 'maidWhite' })
      applyTheme(theme)
      expect(document.documentElement.dataset.theme).toBe('light')
      expect(document.documentElement.dataset.visualSkin).toBe('maid-white')

      applyVisualSkin({ ...activeSettings, mascotStyle: 'none' })
      applyTheme(theme)
      expect(document.documentElement.dataset.visualSkin).toBeUndefined()
      expect(document.documentElement.dataset.theme).toBe(theme)
      expect(document.documentElement.dataset.appearance).toBe(appearance)
    }
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

  it('applies imported declarative tokens and clears them when switching away', () => {
    setCustomSkinCatalog([
      {
        id: 'custom-test',
        name: 'Custom Test',
        version: '1.0.0',
        description: null,
        author: null,
        appearance: 'light',
        tokens: { accent: '#123456', workspace: '#f5f5f5' },
        previewDataUrl: null,
        wallpaperDataUrl: 'data:image/png;base64,cG5n',
        portraitDataUrl: null
      }
    ])

    applyVisualSkin({ ...activeSettings, customSkinId: 'custom-test' })
    expect(document.documentElement.dataset.visualSkin).toBe('custom-custom-test')
    expect(document.documentElement.dataset.customSkin).toBe('true')
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#123456')
    expect(document.documentElement.style.getPropertyValue('--custom-skin-wallpaper')).toContain(
      'data:image/png;base64,cG5n'
    )

    applyVisualSkin({ ...activeSettings, mascotStyle: 'none', customSkinId: null })
    expect(document.documentElement.dataset.customSkin).toBeUndefined()
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('')
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
