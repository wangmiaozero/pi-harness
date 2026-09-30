import { describe, expect, it } from 'vitest'
import { APP_THEMES, normalizeAppTheme, themeAppearance } from './theme'

describe('app theme', () => {
  it('keeps supported palettes and rejects unsupported values', () => {
    expect(normalizeAppTheme('pink')).toBe('pink')
    expect(normalizeAppTheme('purple')).toBe('purple')
    expect(normalizeAppTheme('green')).toBe('green')
    expect(normalizeAppTheme('macos27-light')).toBe('macos27-light')
    expect(normalizeAppTheme('macos27')).toBe('macos27')
    expect(normalizeAppTheme('system')).toBe('dark')
    expect(normalizeAppTheme('neon')).toBe('dark')
  })

  it('maps color palettes to the light native appearance', () => {
    expect(themeAppearance('dark')).toBe('dark')
    expect(themeAppearance('light')).toBe('light')
    expect(themeAppearance('pink')).toBe('light')
    expect(themeAppearance('macos27-light')).toBe('light')
    expect(themeAppearance('macos27')).toBe('dark')
  })

  it('keeps the existing palettes and appends macOS 27 as an independent theme', () => {
    expect(APP_THEMES).toEqual([
      'dark',
      'light',
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
