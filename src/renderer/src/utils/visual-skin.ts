import { shallowRef } from 'vue'
import type { MascotStyle } from '@shared/constants/mascot'
import { resolveMascotStyle, STARSHIP_COCKPIT_MASCOT_STYLE } from '@shared/constants/mascot'
import { marketFileUrl } from '@shared/market/urls'
import { themePackForStyle } from '@shared/market/style-packs'
import { getCustomVisualSkin, getVisualSkin, type VisualSkin } from './skin-catalog'
import type { CustomSkinTokenKey } from '@shared/types/custom-skin'

const installedPacks = new Set<string>()
const installedPets = new Set<string>()
let installCatalogReady = false
const appliedImageVars = new Set<string>()

/** Bumped when the installed catalog changes so settings previews re-render. */
export const installRevision = shallowRef(0)

export interface InstalledThemeAsset {
  packId: string
  styles: string[]
  cssImages?: Record<string, string>
  startup?: boolean
}

export function setInstalledThemeAssets(themes: InstalledThemeAsset[] | null): void {
  installedPacks.clear()
  installCatalogReady = themes !== null
  for (const theme of themes ?? []) {
    installedPacks.add(theme.packId)
    for (const style of theme.styles) installedPacks.add(style)
  }
  const root = document.documentElement
  for (const property of appliedImageVars) root.style.removeProperty(property)
  appliedImageVars.clear()
  for (const theme of themes ?? []) {
    for (const [property, file] of Object.entries(theme.cssImages ?? {})) {
      root.style.setProperty(property, `url("${marketFileUrl('theme', theme.packId, file)}")`)
      appliedImageVars.add(property)
    }
  }
  installRevision.value += 1
}

export function themeAssetsReady(): boolean {
  return installCatalogReady
}

export function selectedThemePackMissing(
  settings: { mascotStyle: MascotStyle } | null | undefined
): boolean {
  if (!settings || !themeAssetsReady() || settings.mascotStyle === 'none') return false
  return !themePackInstalled(settings.mascotStyle)
}

export function themePackInstalled(style: MascotStyle | null | undefined): boolean {
  if (!installCatalogReady) return true
  const pack = themePackForStyle(style)
  if (!pack) return false
  return installedPacks.has(pack) || installedPacks.has(style ?? '')
}

export function setInstalledPetIds(ids: readonly string[]): void {
  installedPets.clear()
  for (const id of ids) installedPets.add(id)
  installRevision.value += 1
}

export function themeCardPreview(
  style: MascotStyle,
  image: string | null,
  failed = false
): 'empty' | 'image' | 'missing' {
  if (!image) return 'empty'
  if (failed || !themePackInstalled(style)) return 'missing'
  return 'image'
}

export function petPackInstalled(id: string | null | undefined): boolean {
  if (!installCatalogReady || !id) return !installCatalogReady
  return installedPets.has(id)
}

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
  const custom = getCustomVisualSkin(settings.customSkinId)
  if (custom) return custom
  if (!themePackInstalled(settings.mascotStyle)) return undefined
  return getVisualSkin(settings.mascotStyle)
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
