import { MASCOT_ENABLED } from '@shared/feature-flags'

export const APP_ICON_CHOICES = ['classic', 'ming', 'quantum'] as const
export const APP_ICON_PREFERENCES = ['auto', ...APP_ICON_CHOICES] as const

export type AppIconId = (typeof APP_ICON_CHOICES)[number]
export type AppIconPreference = (typeof APP_ICON_PREFERENCES)[number]

export function normalizeAppIconPreference(value: unknown): AppIconPreference {
  return APP_ICON_PREFERENCES.includes(value as AppIconPreference)
    ? (value as AppIconPreference)
    : 'auto'
}

export function resolveAppIcon(preference: AppIconPreference, mingDynasty: boolean): AppIconId {
  return preference === 'auto' ? (mingDynasty ? 'ming' : 'classic') : preference
}

export function isMingDynastyTheme(
  mascotStyle: string,
  mascotUnlocked: boolean,
  mascotEnabled = MASCOT_ENABLED
): boolean {
  return (
    mascotEnabled && mascotUnlocked && (mascotStyle === 'mingSnow' || mascotStyle === 'mingMoon')
  )
}
