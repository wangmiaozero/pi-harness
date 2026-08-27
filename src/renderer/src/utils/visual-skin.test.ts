import { afterEach, describe, expect, it } from 'vitest'
import { applyVisualSkin, isStarshipCockpitActive } from './visual-skin'

const activeSettings = {
  mascotStyle: 'starshipCockpit' as const,
  mascotUnlocked: true,
  petEnabled: true
}

afterEach(() => {
  delete document.documentElement.dataset.visualSkin
  delete document.documentElement.dataset.theme
  document.documentElement.style.colorScheme = ''
})

describe('starship cockpit visual skin', () => {
  it('activates only for the enabled and unlocked special mascot', () => {
    expect(isStarshipCockpitActive(activeSettings)).toBe(true)
    expect(isStarshipCockpitActive({ ...activeSettings, petEnabled: false })).toBe(false)
    expect(isStarshipCockpitActive({ ...activeSettings, mascotUnlocked: false })).toBe(false)
    expect(isStarshipCockpitActive({ ...activeSettings, mascotStyle: 'office' })).toBe(false)
  })

  it('overrides the visual skin independently while preserving the stored theme marker', () => {
    document.documentElement.dataset.theme = 'light'

    applyVisualSkin(activeSettings)

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.visualSkin).toBe('starship-cockpit')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    applyVisualSkin({ ...activeSettings, mascotStyle: 'office' })
    expect(document.documentElement.dataset.visualSkin).toBeUndefined()
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
