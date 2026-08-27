import type { MascotStyle } from '@shared/constants/mascot'
import { STARSHIP_COCKPIT_MASCOT_STYLE } from '@shared/constants/mascot'

export const STARSHIP_COCKPIT_SKIN = 'starship-cockpit'

export interface VisualSkinSettings {
  mascotStyle: MascotStyle
  mascotUnlocked: boolean
  petEnabled: boolean
}

export function isStarshipCockpitActive(settings: VisualSkinSettings | null | undefined): boolean {
  return Boolean(
    settings?.mascotUnlocked &&
      settings.petEnabled &&
      settings.mascotStyle === STARSHIP_COCKPIT_MASCOT_STYLE
  )
}

export function applyVisualSkin(settings: VisualSkinSettings | null | undefined): void {
  const root = document.documentElement
  if (isStarshipCockpitActive(settings)) {
    root.dataset.visualSkin = STARSHIP_COCKPIT_SKIN
    root.dataset.theme = 'dark'
    root.style.colorScheme = 'dark'
    return
  }

  delete root.dataset.visualSkin
}
