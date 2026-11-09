import type { MascotStyle } from '@shared/constants/mascot'
import { MASCOT_ENABLED } from '@shared/feature-flags'
import { BUNDLED_PACK_ID } from '@shared/pet/desktop'

export interface BigfishStartupSettings {
  mascotStyle?: MascotStyle
  mascotUnlocked?: boolean
  customSkinId?: string | null
  desktopPet?: {
    enabled?: boolean
    activePackId?: string
    reducedMotion?: boolean
  }
}

/**
 * Rope portraits that play the current boot sequence. Phoebe does not.
 * DeepSeek Work Mode and DeepSeek Deep Dream use the same sequence.
 */
const PORTRAIT_WELCOME_STYLES = new Set<MascotStyle>([
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
 * The vendored boot sequence can play when the bundled 大肥鱼 pack is the
 * active desktop pet and that pet is turned on. A selected theme does not
 * use this path. Reduced motion keeps the short particle startup.
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

/** Splash and boot clips. The two wallpaper themes match DeepSeek and DeepSeek Pro. */
const DEEPSEEK_BOOT_STYLES = new Set<MascotStyle>([
  'ropeDeepseek',
  'ropeWhale',
  'deepseekPoster',
  'deepseekDream'
])
/** Looping chat video. The wallpaper themes keep their own pictures. */
const DEEPSEEK_VIDEO_SKIN_STYLES = new Set<MascotStyle>(['ropeDeepseek', 'ropeWhale'])

export type DeepseekVideoPlacement = 'after' | 'only'
export type DeepseekBootClip = 'boot' | 'scan'

/** DeepSeek, DeepSeek Pro, and the two DeepSeek wallpapers share the video boot. */
export function usesDeepseekVideoStartup(
  settings: BigfishStartupSettings | null | undefined,
  options?: { mascotEnabled?: boolean; reducedMotion?: boolean }
): boolean {
  const mascotEnabled = options?.mascotEnabled ?? MASCOT_ENABLED
  if (!mascotEnabled || options?.reducedMotion || !settings?.mascotUnlocked) return false
  return settings.mascotStyle != null && DEEPSEEK_BOOT_STYLES.has(settings.mascotStyle)
}

/** Below one half, the video plays by itself. Otherwise it follows the current startup. */
export function deepseekVideoPlacement(roll: number): DeepseekVideoPlacement {
  return roll < 0.5 ? 'only' : 'after'
}

/** The two boot clips never play in the same launch. */
export function deepseekBootClip(roll: number): DeepseekBootClip {
  return roll < 0.5 ? 'boot' : 'scan'
}

/** DeepSeek and DeepSeek Pro use the looping chat video as their theme background. */
export function usesDeepseekVideoSkin(
  settings: BigfishStartupSettings | null | undefined,
  options?: { mascotEnabled?: boolean; reducedMotion?: boolean }
): boolean {
  const mascotEnabled = options?.mascotEnabled ?? MASCOT_ENABLED
  if (
    !mascotEnabled ||
    options?.reducedMotion ||
    !settings?.mascotUnlocked ||
    settings.customSkinId
  ) {
    return false
  }
  return settings.mascotStyle != null && DEEPSEEK_VIDEO_SKIN_STYLES.has(settings.mascotStyle)
}

/**
 * The same boot sequence follows the selected rope portrait and DeepSeek Work Mode.
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

/**
 * Theme startup and the desktop pet are separate. A selected theme uses its
 * own sequence. 大肥鱼 adds the vendored boot only when no theme is selected.
 */
export function usesCinematicStartup(
  settings: BigfishStartupSettings | null | undefined,
  options?: { mascotEnabled?: boolean; reducedMotion?: boolean }
): boolean {
  if (usesPortraitWelcomeStartup(settings, options)) return true
  if (settings?.mascotUnlocked && settings.mascotStyle && settings.mascotStyle !== 'none') {
    return false
  }
  return usesBigfishStartup(settings, options)
}
