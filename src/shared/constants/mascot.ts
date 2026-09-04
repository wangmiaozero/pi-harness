export const MASCOT_STYLES = [
  'none',
  'maidWhite',
  'office',
  'starshipCockpit',
  'noirScholar',
  'moonlitMaid'
] as const

export type MascotStyle = (typeof MASCOT_STYLES)[number]

export const DEFAULT_MASCOT_STYLE: MascotStyle = 'none'
export const STARSHIP_COCKPIT_MASCOT_STYLE: MascotStyle = 'starshipCockpit'

/**
 * Styles that currently borrow the scene background and immersive skin of
 * another theme while keeping their own characters.
 */
export const MASCOT_STYLE_VISUAL_ALIASES: Partial<Record<MascotStyle, MascotStyle>> = {
  maidWhite: 'starshipCockpit',
  office: 'noirScholar'
}

export function resolveMascotStyle(style: MascotStyle): MascotStyle {
  return MASCOT_STYLE_VISUAL_ALIASES[style] ?? style
}
export const MASCOT_UNLOCK_ANSWER = '1024'

export function normalizeMascotStyle(value: unknown): MascotStyle {
  return MASCOT_STYLES.includes(value as MascotStyle)
    ? (value as MascotStyle)
    : DEFAULT_MASCOT_STYLE
}

export function isMascotUnlockAnswer(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === MASCOT_UNLOCK_ANSWER
}
