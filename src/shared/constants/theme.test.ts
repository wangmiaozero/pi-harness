import { describe, expect, it } from 'vitest'
import { normalizeAppTheme, themeAppearance } from './theme'

describe('app theme', () => {
  it('keeps supported palettes and rejects unsupported values', () => {
    expect(normalizeAppTheme('pink')).toBe('pink')
    expect(normalizeAppTheme('purple')).toBe('purple')
    expect(normalizeAppTheme('green')).toBe('green')
    expect(normalizeAppTheme('system')).toBe('dark')
    expect(normalizeAppTheme('neon')).toBe('dark')
  })

  it('maps color palettes to the light native appearance', () => {
    expect(themeAppearance('dark')).toBe('dark')
    expect(themeAppearance('light')).toBe('light')
    expect(themeAppearance('pink')).toBe('light')
  })
})
