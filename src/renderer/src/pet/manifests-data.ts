import { PET_STATES, type PetManifest, type PetState, type PetThemeId } from '@shared/pet/types'
import { singleFrameAnimation } from '@shared/pet/animations'
import officeImage from '@renderer/assets/mascot/pico-office.png'
import maidWhiteImage from '@renderer/assets/mascot/pico-maid-white.png'
import frostNavigatorImage from '@renderer/assets/themes/starship-cockpit/frost-navigator.png'
import noirScholarImage from '@renderer/assets/themes/portraits/noir-scholar.png'
import moonlitMaidImage from '@renderer/assets/themes/portraits/moonlit-maid.png'
import mingSnowImage from '@renderer/assets/themes/ming-dynasty/snow-maiden.png'
import mingMoonImage from '@renderer/assets/themes/ming-dynasty/moon-maiden.png'
import zhangJuzhengSnowImage from '@renderer/assets/themes/zhang-juzheng-snow/zhang-juzheng.png'
import ropeWhaleImage from '@renderer/assets/themes/rope/whale.png'
import ropePhoebeImage from '@renderer/assets/themes/rope/phoebe.png'
import ropeClaudeImage from '@renderer/assets/themes/rope/claude.png'
import ropeDeepseekImage from '@renderer/assets/themes/rope/deepseek.png'
import deepseekPosterImage from '@renderer/assets/themes/deepseek-poster/default-background.jpg'
import deepseekDreamImage from '@renderer/assets/themes/deepseek-dream/wallpaper.png'
import ropeGeminiImage from '@renderer/assets/themes/rope/gemini.png'
import ropeGptImage from '@renderer/assets/themes/rope/gpt.png'
import ropeGlmImage from '@renderer/assets/themes/rope/glm.png'
import ropeGrokImage from '@renderer/assets/themes/rope/grok.png'
import ropeKimiImage from '@renderer/assets/themes/rope/kimi.png'
import ropeQwenImage from '@renderer/assets/themes/rope/qwen.png'

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

function ropeManifest(
  id: PetThemeId,
  name: string,
  sprite: string,
  accent: string,
  frameWidth: number,
  frameHeight: number
): PetManifest {
  return { ...manifest(id, name, sprite, accent, true), frameWidth, frameHeight }
}

function manifest(
  id: PetThemeId,
  name: string,
  sprite: string,
  accent: string,
  priority = false
): PetManifest {
  return {
    id,
    name,
    sprite,
    frameWidth: 1024,
    frameHeight: 1536,
    columns: 1,
    rows: 1,
    accent,
    priority,
    animations: priority ? FULL_SINGLE_FRAME_ANIMATIONS : FALLBACK_SINGLE_FRAME_ANIMATIONS
  }
}

/** Built-in manifests. Priority themes expose all state animation entries immediately. */
export const PET_MANIFESTS: Readonly<Record<PetThemeId, PetManifest>> = {
  maidWhite: manifest('maidWhite', 'Maid Style (White Stockings)', maidWhiteImage, '#3868bd', true),
  office: manifest('office', 'Office Style (Black Tights)', officeImage, '#c5a176', true),
  noirScholar: manifest(
    'noirScholar',
    'Noir Study · Silver Scholar',
    noirScholarImage,
    '#b18a50',
    true
  ),
  moonlitMaid: manifest(
    'moonlitMaid',
    'Moonlit Salon · Silver Maid',
    moonlitMaidImage,
    '#806284',
    true
  ),
  mingSnow: manifest(
    'mingSnow',
    'Ming Snow Palace · Flute Scholar',
    mingSnowImage,
    '#bd8b52',
    true
  ),
  zhangJuzhengSnow: manifest(
    'zhangJuzhengSnow',
    'Zhang Juzheng · Snowbound Ming',
    zhangJuzhengSnowImage,
    '#9e1b1b',
    true
  ),
  mingMoon: manifest('mingMoon', 'Ming Moon City · Scroll Scholar', mingMoonImage, '#b4493f', true),
  ropeWhale: ropeManifest('ropeWhale', 'DeepSeek Pro', ropeWhaleImage, '#2f6fe0', 384, 576),
  ropePhoebe: ropeManifest('ropePhoebe', 'Phoebe', ropePhoebeImage, '#f0c14a', 283, 384),
  ropeClaude: ropeManifest('ropeClaude', 'Claude', ropeClaudeImage, '#e07a2f', 324, 384),
  ropeDeepseek: ropeManifest('ropeDeepseek', 'DeepSeek', ropeDeepseekImage, '#3aa0ff', 330, 384),
  deepseekPoster: ropeManifest(
    'deepseekPoster',
    'DeepSeek Work Mode',
    deepseekPosterImage,
    '#3aa0ff',
    1920,
    1080
  ),
  deepseekDream: ropeManifest(
    'deepseekDream',
    'DeepSeek Deep Dream',
    deepseekDreamImage,
    '#3aa0ff',
    1290,
    725
  ),
  ropeGemini: ropeManifest('ropeGemini', 'Gemini', ropeGeminiImage, '#7a5cff', 296, 384),
  ropeGpt: ropeManifest('ropeGpt', 'GPT', ropeGptImage, '#d7dde8', 320, 384),
  ropeGlm: ropeManifest('ropeGlm', 'GLM', ropeGlmImage, '#7aa2ff', 308, 384),
  ropeGrok: ropeManifest('ropeGrok', 'Grok', ropeGrokImage, '#e2b340', 311, 384),
  ropeKimi: ropeManifest('ropeKimi', 'Kimi', ropeKimiImage, '#9aa4ff', 299, 384),
  ropeQwen: ropeManifest('ropeQwen', 'Qwen', ropeQwenImage, '#5b8def', 307, 384),
  starshipCockpit: {
    ...manifest(
      'starshipCockpit',
      'Starship Cockpit · Frost Navigator',
      frostNavigatorImage,
      '#67d8ff',
      true
    ),
    frameWidth: 941,
    frameHeight: 1672
  }
}
