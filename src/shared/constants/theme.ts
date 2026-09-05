export const APP_THEMES = [
  'dark',
  'light',
  'pink',
  'purple',
  'green',
  'blue',
  'orange',
  'red',
  'cyan'
] as const

export type AppTheme = (typeof APP_THEMES)[number]
export type ThemeAppearance = 'dark' | 'light'

export function normalizeAppTheme(value: unknown): AppTheme {
  return APP_THEMES.includes(value as AppTheme) ? (value as AppTheme) : 'dark'
}

/** Native controls, toasts and screen overlays only accept light/dark appearances. */
export function themeAppearance(theme: AppTheme): ThemeAppearance {
  return theme === 'dark' ? 'dark' : 'light'
}
