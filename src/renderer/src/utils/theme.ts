import { themeAppearance, type AppTheme } from '@shared/constants/theme'
import { getSkinAppearance } from './skin-catalog'

/** A visual skin owns its appearance without overwriting the saved plain palette. */
export function applyTheme(pref: AppTheme): void {
  const root = document.documentElement
  const theme = getSkinAppearance(root.dataset.visualSkin) ?? pref
  root.dataset.theme = theme
  root.dataset.appearance = themeAppearance(theme)
  root.style.colorScheme = themeAppearance(theme)
}
