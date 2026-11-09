import { PET_STATES, type PetManifest, type PetState, type PetThemeId } from '@shared/pet/types'
import { singleFrameAnimation } from '@shared/pet/animations'
import { marketFileUrl } from '@shared/market/urls'
import { themePackForStyle } from '@shared/market/style-packs'
import type { MascotStyle } from '@shared/constants/mascot'

export const PET_THEME_ORDER: readonly PetThemeId[] = [
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
]

function animations(states: readonly PetState[]): PetManifest['animations'] {
  return Object.fromEntries(states.map((state) => [state, singleFrameAnimation(state)]))
}

const FULL_SINGLE_FRAME_ANIMATIONS = animations(PET_STATES)
const FALLBACK_SINGLE_FRAME_ANIMATIONS = animations([
  'idle',
  'running',
  'failed',
  'waving',
  'jumping'
])

function sprite(style: MascotStyle, file: string): string {
  const pack = themePackForStyle(style)
  if (!pack) throw new Error(`Missing theme pack for ${style}`)
  return marketFileUrl('theme', pack, file)
}

function ropeManifest(
  id: PetThemeId,
  name: string,
  file: string,
  accent: string,
  frameWidth: number,
  frameHeight: number
): PetManifest {
  return { ...manifest(id, name, sprite(id, file), accent, true), frameWidth, frameHeight }
}

function manifest(
  id: PetThemeId,
  name: string,
  image: string,
  accent: string,
  priority = false
): PetManifest {
  return {
    id,
    name,
    sprite: image,
    frameWidth: 1024,
    frameHeight: 1536,
    columns: 1,
    rows: 1,
    accent,
    priority,
    animations: priority ? FULL_SINGLE_FRAME_ANIMATIONS : FALLBACK_SINGLE_FRAME_ANIMATIONS
  }
}

/** Built-in manifests. Artwork is loaded from an installed theme pack. */
export const PET_MANIFESTS: Readonly<Record<PetThemeId, PetManifest>> = {
  maidWhite: manifest(
    'maidWhite',
    'Maid Style (White Stockings)',
    sprite('maidWhite', 'assets/pico-maid-white.png'),
    '#3868bd',
    true
  ),
  office: manifest(
    'office',
    'Office Style (Black Tights)',
    sprite('office', 'assets/pico-office.png'),
    '#c5a176',
    true
  ),
  noirScholar: manifest(
    'noirScholar',
    'Noir Study · Silver Scholar',
    sprite('noirScholar', 'assets/noir-scholar.png'),
    '#b18a50',
    true
  ),
  moonlitMaid: manifest(
    'moonlitMaid',
    'Moonlit Salon · Silver Maid',
    sprite('moonlitMaid', 'assets/moonlit-maid.png'),
    '#806284',
    true
  ),
  mingSnow: manifest(
    'mingSnow',
    'Ming Snow Palace · Flute Scholar',
    sprite('mingSnow', 'assets/snow-maiden.png'),
    '#bd8b52',
    true
  ),
  zhangJuzhengSnow: manifest(
    'zhangJuzhengSnow',
    'Zhang Juzheng · Snowbound Ming',
    sprite('zhangJuzhengSnow', 'assets/zhang-juzheng.png'),
    '#9e1b1b',
    true
  ),
  mingMoon: manifest(
    'mingMoon',
    'Ming Moon City · Scroll Scholar',
    sprite('mingMoon', 'assets/moon-maiden.png'),
    '#b4493f',
    true
  ),
  ropeWhale: ropeManifest('ropeWhale', 'DeepSeek Pro', 'assets/portraits/whale.png', '#2f6fe0', 384, 576),
  ropePhoebe: ropeManifest('ropePhoebe', 'Phoebe', 'assets/phoebe.png', '#f0c14a', 283, 384),
  ropeClaude: ropeManifest('ropeClaude', 'Claude', 'assets/claude.png', '#e07a2f', 324, 384),
  ropeDeepseek: ropeManifest(
    'ropeDeepseek',
    'DeepSeek',
    'assets/portraits/deepseek.png',
    '#3aa0ff',
    330,
    384
  ),
  deepseekPoster: ropeManifest(
    'deepseekPoster',
    'DeepSeek Work Mode',
    'assets/wallpapers/default-background.jpg',
    '#3aa0ff',
    1920,
    1080
  ),
  deepseekDream: ropeManifest(
    'deepseekDream',
    'DeepSeek Deep Dream',
    'assets/wallpapers/wallpaper.png',
    '#3aa0ff',
    1290,
    725
  ),
  ropeGemini: ropeManifest('ropeGemini', 'Gemini', 'assets/gemini.png', '#7a5cff', 296, 384),
  ropeGpt: ropeManifest('ropeGpt', 'GPT', 'assets/gpt.png', '#d7dde8', 320, 384),
  ropeGlm: ropeManifest('ropeGlm', 'GLM', 'assets/glm.png', '#7aa2ff', 308, 384),
  ropeGrok: ropeManifest('ropeGrok', 'Grok', 'assets/grok.png', '#e2b340', 311, 384),
  ropeKimi: ropeManifest('ropeKimi', 'Kimi', 'assets/kimi.png', '#9aa4ff', 299, 384),
  ropeQwen: ropeManifest('ropeQwen', 'Qwen', 'assets/qwen.png', '#5b8def', 307, 384),
  starshipCockpit: {
    ...manifest(
      'starshipCockpit',
      'Starship Cockpit · Frost Navigator',
      sprite('starshipCockpit', 'assets/frost-navigator.png'),
      '#67d8ff',
      true
    ),
    frameWidth: 941,
    frameHeight: 1672
  }
}
