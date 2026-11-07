export const MASCOT_STYLES = [
  'none',
  'maidWhite',
  'office',
  'starshipCockpit',
  'noirScholar',
  'moonlitMaid',
  'mingSnow',
  'zhangJuzhengSnow',
  'mingMoon',
  'ropeWhale',
  'ropePhoebe',
  'ropeClaude',
  'ropeDeepseek',
  'deepseekPoster',
  'deepseekDream',
  'ropeGemini',
  'ropeGpt',
  'ropeGlm',
  'ropeGrok',
  'ropeKimi',
  'ropeQwen'
] as const

export type MascotStyle = (typeof MASCOT_STYLES)[number]

export const DEFAULT_MASCOT_STYLE: MascotStyle = 'none'
export const STARSHIP_COCKPIT_MASCOT_STYLE: MascotStyle = 'starshipCockpit'

export function resolveMascotStyle(style: MascotStyle): MascotStyle {
  return style
}
export const MASCOT_UNLOCK_ANSWER = '1024'

export function normalizeMascotStyle(value: unknown): MascotStyle {
  if (value === 'wallpaperEngine') return 'ropeDeepseek'
  return MASCOT_STYLES.includes(value as MascotStyle)
    ? (value as MascotStyle)
    : DEFAULT_MASCOT_STYLE
}

export function isMascotUnlockAnswer(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === MASCOT_UNLOCK_ANSWER
}
