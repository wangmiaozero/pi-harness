import { describe, expect, it } from 'vitest'
import { normalizeAppTheme, themeAppearance } from './theme'

describe('app theme', () => {
  it('migrates the removed system choice to the current appearance', () => {
    expect(normalizeAppTheme('system', 'dark')).toBe('dark')
    expect(normalizeAppTheme('system', 'light')).toBe('light')
  })

  it('keeps supported palettes and rejects stale values', () => {
    expect(normalizeAppTheme('pink')).toBe('pink')
    expect(normalizeAppTheme('purple')).toBe('purple')
    expect(normalizeAppTheme('green')).toBe('green')
    expect(normalizeAppTheme('neon')).toBe('dark')
  })

  it('maps color palettes to the light native appearance', () => {
    expect(themeAppearance('dark')).toBe('dark')
    expect(themeAppearance('light')).toBe('light')
    expect(themeAppearance('pink')).toBe('light')
  })
})
