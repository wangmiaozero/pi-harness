import type { MascotStyle } from '@shared/constants/mascot'
import { resolveMascotStyle } from '@shared/constants/mascot'
import type { CustomSkinDescriptor } from '@shared/types/custom-skin'

/** Visual-only presets; ordinary color preferences are retained when a skin is active. */
export const VISUAL_SKINS = {
  maidWhite: { id: 'maid-white', appearance: 'light', portrait: true },
  office: { id: 'office-executive', appearance: 'dark', portrait: true },
  starshipCockpit: { id: 'starship-cockpit', appearance: 'dark', portrait: false },
  noirScholar: { id: 'noir-scholar', appearance: 'dark', portrait: true },
  moonlitMaid: { id: 'moonlit-maid', appearance: 'light', portrait: true },
  mingSnow: { id: 'ming-snow', appearance: 'dark', portrait: true },
  zhangJuzhengSnow: { id: 'zhang-juzheng-snow', appearance: 'dark', portrait: true },
  mingMoon: { id: 'ming-moon', appearance: 'dark', portrait: true }
} as const

export interface VisualSkin {
  id: string
  appearance: 'dark' | 'light'
  portrait: boolean
  custom?: CustomSkinDescriptor
}

export function getVisualSkin(style: MascotStyle): VisualSkin | undefined {
  const resolved = resolveMascotStyle(style)
  return Object.hasOwn(VISUAL_SKINS, resolved)
    ? VISUAL_SKINS[resolved as keyof typeof VISUAL_SKINS]
    : undefined
}

let customSkinCatalog = new Map<string, CustomSkinDescriptor>()

export function setCustomSkinCatalog(skins: CustomSkinDescriptor[]): void {
  customSkinCatalog = new Map(skins.map((skin) => [skin.id, skin]))
}

export function getCustomVisualSkin(id: string | null | undefined): VisualSkin | undefined {
  if (!id) return undefined
  const custom = customSkinCatalog.get(id)
  return custom
    ? {
        id: `custom-${custom.id}`,
        appearance: custom.appearance,
        portrait: Boolean(custom.portraitDataUrl),
        custom
      }
    : undefined
}

export function getSkinAppearance(id: string | undefined): 'dark' | 'light' | undefined {
  return (
    Object.values(VISUAL_SKINS).find((skin) => skin.id === id)?.appearance ??
    [...customSkinCatalog.values()].find((skin) => `custom-${skin.id}` === id)?.appearance
  )
}

export function isMingDynastySkin(id: string | undefined): boolean {
  return id === 'ming-snow' || id === 'zhang-juzheng-snow' || id === 'ming-moon'
}
