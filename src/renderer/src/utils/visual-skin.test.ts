import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme } from './theme'
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

  it('pins appearance to dark so light/dark preference cannot restyle the cockpit', () => {
    applyVisualSkin(activeSettings)
    applyTheme('light')

    expect(document.documentElement.dataset.visualSkin).toBe('starship-cockpit')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    applyVisualSkin({ ...activeSettings, mascotStyle: 'office' })
    applyTheme('light')

    expect(document.documentElement.dataset.visualSkin).toBeUndefined()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
