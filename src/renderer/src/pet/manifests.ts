import type { MascotStyle } from '@shared/constants/mascot'
import { PET_STATES, type PetManifest, type PetState, type PetThemeId } from '@shared/pet/types'
import { singleFrameAnimation } from '@shared/pet/animations'
import knowledgeImage from '@renderer/assets/mascot/pico-knowledge.png'
import engineerImage from '@renderer/assets/mascot/pico-engineer.png'
import maidImage from '@renderer/assets/mascot/pico-maid.png'
import matureImage from '@renderer/assets/mascot/pico-mature.png'
import officeImage from '@renderer/assets/mascot/pico-office.png'
import maidWhiteImage from '@renderer/assets/mascot/pico-maid-white.png'
import frostNavigatorImage from '@renderer/assets/themes/starship-cockpit/frost-navigator.png'

export const PET_THEME_ORDER: readonly PetThemeId[] = [
  'maidWhite',
  'office',
  'knowledge',
  'engineer',
  'maid',
  'mature',
  'starshipCockpit'
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
  maidWhite: manifest('maidWhite', 'Maid Style (White Stockings)', maidWhiteImage, '#7ab8ff', true),
  office: manifest('office', 'Office Style (Black Tights)', officeImage, '#8caeff', true),
  knowledge: manifest('knowledge', 'Infinite Knowledge', knowledgeImage, '#558cff'),
  engineer: manifest('engineer', 'Engineering Executor', engineerImage, '#3d8cff'),
  maid: manifest('maid', 'Maid Assistant', maidImage, '#669dff'),
  mature: manifest('mature', 'Mature Navigator', matureImage, '#8aa8ff'),
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

export function getPetManifest(style: MascotStyle): PetManifest | null {
  return style === 'none' ? null : PET_MANIFESTS[style]
}
