import type { MascotStyle } from '@shared/constants/mascot'

/** Visual-only presets; ordinary color preferences are retained when a skin is active. */
export const VISUAL_SKINS = {
  starshipCockpit: { id: 'starship-cockpit', appearance: 'dark', portrait: false },
  noirScholar: { id: 'noir-scholar', appearance: 'dark', portrait: true },
  moonlitMaid: { id: 'moonlit-maid', appearance: 'light', portrait: true }
} as const

export type VisualSkin = (typeof VISUAL_SKINS)[keyof typeof VISUAL_SKINS]

export function getVisualSkin(style: MascotStyle): VisualSkin | undefined {
  return Object.hasOwn(VISUAL_SKINS, style)
    ? VISUAL_SKINS[style as keyof typeof VISUAL_SKINS]
    : undefined
}

export function getSkinAppearance(id: string | undefined): 'dark' | 'light' | undefined {
  return Object.values(VISUAL_SKINS).find((skin) => skin.id === id)?.appearance
}
