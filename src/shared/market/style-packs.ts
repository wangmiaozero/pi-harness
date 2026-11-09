import type { MascotStyle } from '@shared/constants/mascot'

/** Existing mascot style ids stay stable. The value is the theme pack id, not the npm name. */
export const THEME_PACK_BY_STYLE: Partial<Record<MascotStyle, string>> = {
  maidWhite: 'maid-white',
  office: 'office',
  starshipCockpit: 'starship',
  noirScholar: 'noir-scholar',
  moonlitMaid: 'moonlit-maid',
  mingSnow: 'ming-snow',
  zhangJuzhengSnow: 'zhang-juzheng',
  mingMoon: 'ming-moon',
  ropeWhale: 'deepseek',
  ropePhoebe: 'phoebe',
  ropeClaude: 'claude',
  ropeDeepseek: 'deepseek',
  deepseekPoster: 'deepseek',
  deepseekDream: 'deepseek',
  ropeGemini: 'gemini',
  ropeGpt: 'gpt',
  ropeGlm: 'glm',
  ropeGrok: 'grok',
  ropeKimi: 'kimi',
  ropeQwen: 'qwen'
}

export function themePackForStyle(style: MascotStyle | null | undefined): string | null {
  if (!style) return null
  return THEME_PACK_BY_STYLE[style] ?? null
}

export const STARTUP_STYLES = new Set<MascotStyle>([
  'ropeWhale',
  'ropeDeepseek',
  'deepseekPoster',
  'deepseekDream',
  'ropeClaude',
  'ropeGemini',
  'ropeGpt',
  'ropeGlm',
  'ropeGrok',
  'ropeKimi',
  'ropeQwen'
])
