import type { MascotStyle } from '@shared/constants/mascot'
import { MASCOT_ENABLED } from '@shared/feature-flags'
import { BUNDLED_PACK_ID } from '@shared/pet/desktop'

export interface BigfishStartupSettings {
  mascotStyle?: MascotStyle
  mascotUnlocked?: boolean
  desktopPet?: {
    enabled?: boolean
    activePackId?: string
    reducedMotion?: boolean
  }
}

/** Rope portraits that play the current boot sequence. Phoebe does not. */
const PORTRAIT_WELCOME_STYLES = new Set<MascotStyle>([
  'ropeWhale',
  'ropeDeepseek',
  'ropeClaude',
  'ropeGemini',
  'ropeGpt',
  'ropeGlm',
  'ropeGrok',
  'ropeKimi',
  'ropeQwen'
])

const FINALE_LINE: Partial<Record<MascotStyle, string>> = {
  ropeClaude: 'line-6-claude',
  ropeGemini: 'line-6-gemini',
  ropeGpt: 'line-6-gpt',
  ropeGlm: 'line-6-glm',
  ropeGrok: 'line-6-grok',
  ropeKimi: 'line-6-kimi',
  ropeQwen: 'line-6-qwen'
}

/** DeepSeek and DeepSeek Pro keep the original finale. The other seven swap line-6. */
export function finaleLineKey(style: MascotStyle | null | undefined): string {
  if (!style) return 'line-6'
  return FINALE_LINE[style] ?? 'line-6'
}

const PORTRAIT_BRANDS: Partial<Record<MascotStyle, string>> = {
  ropeClaude: 'Claude',
  ropeGemini: 'Gemini',
  ropeGpt: 'GPT',
  ropeGlm: 'GLM',
  ropeGrok: 'Grok',
  ropeKimi: 'Kimi',
  ropeQwen: 'Qwen'
}

/** Shown once on the black screen. The short name is not repeated underneath. */
const PORTRAIT_FULL_NAMES: Partial<Record<MascotStyle, string>> = {
  ropeClaude: 'Claude Code',
  ropeGemini: 'Google Gemini',
  ropeGpt: 'ChatGPT',
  ropeGlm: '智谱 GLM',
  ropeGrok: 'xAI Grok',
  ropeKimi: '月之暗面 Kimi',
  ropeQwen: '通义千问'
}

export interface StartupBrandCopy {
  brand1: string
  orgZh: string
  orgEn: string
  orgSub: string
  welcomeBox: string
  footer: string
}

/** DeepSeek and DeepSeek Pro keep the vendored DeepSeek copy. */
export function startupBrandCopy(style: MascotStyle | null | undefined): StartupBrandCopy | null {
  const name = style ? PORTRAIT_BRANDS[style] : undefined
  if (!name) return null
  const upper = name.toUpperCase()
  return {
    brand1: upper,
    orgZh: (style && PORTRAIT_FULL_NAMES[style]) || name,
    orgEn: '',
    orgSub: `${upper} HARNESS`,
    welcomeBox: `${upper} HARNESS`,
    footer: `POWERED BY ${upper}`
  }
}

/**
 * The vendored boot sequence plays only when the bundled 大肥鱼 pack is the
 * active desktop pet and that pet is turned on. nomascot builds and reduced
 * motion keep the short particle startup.
 */
export function usesBigfishStartup(
  settings: BigfishStartupSettings | null | undefined,
  options?: { mascotEnabled?: boolean; reducedMotion?: boolean }
): boolean {
  const mascotEnabled = options?.mascotEnabled ?? MASCOT_ENABLED
  if (!mascotEnabled || options?.reducedMotion) return false
  const pet = settings?.desktopPet
  if (!pet?.enabled || pet.reducedMotion) return false
  return pet.activePackId === BUNDLED_PACK_ID
}

/**
 * The same boot sequence follows the selected rope portrait.
 * Phoebe keeps the short particle startup.
 */
export function usesPortraitWelcomeStartup(
  settings: BigfishStartupSettings | null | undefined,
  options?: { mascotEnabled?: boolean; reducedMotion?: boolean }
): boolean {
  const mascotEnabled = options?.mascotEnabled ?? MASCOT_ENABLED
  if (!mascotEnabled || options?.reducedMotion || !settings?.mascotUnlocked) return false
  return settings.mascotStyle != null && PORTRAIT_WELCOME_STYLES.has(settings.mascotStyle)
}
