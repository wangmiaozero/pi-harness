import { describe, expect, it } from 'vitest'
import { APP_THEMES, normalizeAppTheme, themeAppearance } from './theme'

describe('app theme', () => {
  it.each(APP_THEMES)('preserves the %s preference and its native appearance', (theme) => {
    expect(normalizeAppTheme(theme)).toBe(theme)
    expect(themeAppearance(theme)).toBe(
      ['dark', 'soft-dark', 'macos27'].includes(theme) ? 'dark' : 'light'
    )
  })

  it('keeps supported palettes and rejects unsupported values', () => {
    expect(normalizeAppTheme('pink')).toBe('pink')
    expect(normalizeAppTheme('purple')).toBe('purple')
    expect(normalizeAppTheme('green')).toBe('green')
    expect(normalizeAppTheme('macos27-light')).toBe('macos27-light')
    expect(normalizeAppTheme('macos27')).toBe('macos27')
    expect(normalizeAppTheme('soft-dark')).toBe('soft-dark')
    expect(normalizeAppTheme('soft-light')).toBe('soft-light')
    expect(normalizeAppTheme('system')).toBe('soft-light')
    expect(normalizeAppTheme('neon')).toBe('soft-light')
    expect(normalizeAppTheme(undefined)).toBe('soft-light')
  })

  it('maps color palettes to the light native appearance', () => {
    expect(themeAppearance('dark')).toBe('dark')
    expect(themeAppearance('light')).toBe('light')
    expect(themeAppearance('pink')).toBe('light')
    expect(themeAppearance('macos27-light')).toBe('light')
    expect(themeAppearance('macos27')).toBe('dark')
    expect(themeAppearance('soft-dark')).toBe('dark')
    expect(themeAppearance('soft-light')).toBe('light')
  })

  it('keeps the existing palettes and appends macOS 27 as an independent theme', () => {
    expect(APP_THEMES).toEqual([
      'dark',
      'soft-dark',
      'light',
      'soft-light',
      'pink',
      'purple',
      'green',
      'blue',
      'orange',
      'red',
      'cyan',
      'macos27-light',
      'macos27'
    ])
  })
})
