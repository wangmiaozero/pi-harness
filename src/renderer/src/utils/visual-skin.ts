import type { MascotStyle } from '@shared/constants/mascot'
import { resolveMascotStyle, STARSHIP_COCKPIT_MASCOT_STYLE } from '@shared/constants/mascot'
import { getCustomVisualSkin, getVisualSkin, type VisualSkin } from './skin-catalog'
import type { CustomSkinTokenKey } from '@shared/types/custom-skin'

export const STARSHIP_COCKPIT_SKIN = 'starship-cockpit'

export interface VisualSkinSettings {
  mascotStyle: MascotStyle
  mascotUnlocked: boolean
  customSkinId?: string | null
}

const CUSTOM_TOKEN_PROPERTIES: Record<CustomSkinTokenKey, string> = {
  window: '--bg-window',
  titlebar: '--bg-titlebar',
  sidebar: '--bg-sidebar',
  workspace: '--bg-workspace',
  surface: '--bg-surface',
  surfaceRaised: '--bg-surface-raised',
  hover: '--bg-hover',
  selected: '--bg-selected',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textTertiary: '--text-tertiary',
  accent: '--accent',
  accentHover: '--accent-hover',
  accentActive: '--accent-active',
  accentBorder: '--accent-border',
  borderSubtle: '--border-subtle',
  borderDefault: '--border-default',
  borderStrong: '--border-strong',
  controlBackground: '--control-bg',
  controlBorder: '--control-border',
  controlBorderHover: '--control-border-hover'
}

export function getActiveVisualSkin(
  settings: VisualSkinSettings | null | undefined
): VisualSkin | undefined {
  if (!settings?.mascotUnlocked) return undefined
  return getCustomVisualSkin(settings.customSkinId) ?? getVisualSkin(settings.mascotStyle)
}

export function isStarshipCockpitActive(settings: VisualSkinSettings | null | undefined): boolean {
  return Boolean(
    settings?.mascotUnlocked &&
    resolveMascotStyle(settings.mascotStyle) === STARSHIP_COCKPIT_MASCOT_STYLE
  )
}

export function applyVisualSkin(settings: VisualSkinSettings | null | undefined): void {
  const root = document.documentElement
  const skin = getActiveVisualSkin(settings)
  clearCustomSkinProperties(root)
  if (skin) {
    root.dataset.visualSkin = skin.id
    root.dataset.portraitSkin = String(skin.portrait)
    root.dataset.theme = skin.appearance
    root.dataset.appearance = skin.appearance
    root.style.colorScheme = skin.appearance
    if (skin.custom) {
      root.dataset.customSkin = 'true'
      for (const [key, value] of Object.entries(skin.custom.tokens)) {
        const property = CUSTOM_TOKEN_PROPERTIES[key as CustomSkinTokenKey]
        if (property && value) root.style.setProperty(property, value)
      }
      if (skin.custom.wallpaperDataUrl) {
        const wallpaper = `url("${skin.custom.wallpaperDataUrl}")`
        root.style.setProperty('--custom-skin-wallpaper', wallpaper)
        root.style.setProperty('--portrait-scene-image', wallpaper)
      }
    }
    return
  }

  delete root.dataset.visualSkin
  delete root.dataset.portraitSkin
}

function clearCustomSkinProperties(root: HTMLElement): void {
  delete root.dataset.customSkin
  root.style.removeProperty('--custom-skin-wallpaper')
  root.style.removeProperty('--portrait-scene-image')
  for (const property of Object.values(CUSTOM_TOKEN_PROPERTIES)) root.style.removeProperty(property)
}
