import type { MascotStyle } from '@shared/constants/mascot'
import { STARSHIP_COCKPIT_MASCOT_STYLE } from '@shared/constants/mascot'
import { getVisualSkin, type VisualSkin } from './skin-catalog'

export const STARSHIP_COCKPIT_SKIN = 'starship-cockpit'

export interface VisualSkinSettings {
  mascotStyle: MascotStyle
  mascotUnlocked: boolean
  petEnabled: boolean
}

export function getActiveVisualSkin(
  settings: VisualSkinSettings | null | undefined
): VisualSkin | undefined {
  return settings?.mascotUnlocked && settings.petEnabled
    ? getVisualSkin(settings.mascotStyle)
    : undefined
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
  const skin = getActiveVisualSkin(settings)
  if (skin) {
    root.dataset.visualSkin = skin.id
    root.dataset.theme = skin.appearance
    root.dataset.appearance = skin.appearance
    root.style.colorScheme = skin.appearance
    return
  }

  delete root.dataset.visualSkin
}
