export const APP_THEMES = [
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
] as const

export type AppTheme = (typeof APP_THEMES)[number]
export type ThemeAppearance = 'dark' | 'light'

export function normalizeAppTheme(value: unknown): AppTheme {
  return APP_THEMES.includes(value as AppTheme) ? (value as AppTheme) : 'soft-light'
}

/** Native controls, toasts and screen overlays only accept light/dark appearances. */
export function themeAppearance(theme: AppTheme): ThemeAppearance {
  return theme === 'dark' || theme === 'soft-dark' || theme === 'macos27' ? 'dark' : 'light'
}
