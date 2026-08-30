export const APP_THEMES = ['dark', 'light', 'pink', 'purple', 'green'] as const

export type AppTheme = (typeof APP_THEMES)[number]
export type ThemeAppearance = 'dark' | 'light'

/** Legacy system preferences are resolved once, never followed after migration. */
export function normalizeAppTheme(
  value: unknown,
  legacyAppearance: ThemeAppearance = 'dark'
): AppTheme {
  if (value === 'system') return legacyAppearance
  return APP_THEMES.includes(value as AppTheme) ? (value as AppTheme) : 'dark'
}

/** Native controls, toasts and screen overlays only accept light/dark appearances. */
export function themeAppearance(theme: AppTheme): ThemeAppearance {
  return theme === 'dark' ? 'dark' : 'light'
}
