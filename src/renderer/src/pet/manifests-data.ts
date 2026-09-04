import { PET_STATES, type PetManifest, type PetState, type PetThemeId } from '@shared/pet/types'
import { singleFrameAnimation } from '@shared/pet/animations'
import officeImage from '@renderer/assets/mascot/pico-office.png'
import maidWhiteImage from '@renderer/assets/mascot/pico-maid-white.png'
import frostNavigatorImage from '@renderer/assets/themes/starship-cockpit/frost-navigator.png'
import noirScholarImage from '@renderer/assets/themes/portraits/noir-scholar.png'
import moonlitMaidImage from '@renderer/assets/themes/portraits/moonlit-maid.png'

export const PET_THEME_ORDER: readonly PetThemeId[] = [
  'maidWhite',
  'office',
  'starshipCockpit',
  'noirScholar',
  'moonlitMaid'
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

/**
 * Built-in manifests. Priority themes expose all state animation entries
 * immediately. `maidWhite` and `office` keep their own characters but borrow
 * the starship cockpit and noir study scene backgrounds and skins (see
 * `MASCOT_STYLE_VISUAL_ALIASES`) until dedicated scenes exist.
 */
export const PET_MANIFESTS: Readonly<Record<PetThemeId, PetManifest>> = {
  maidWhite: manifest('maidWhite', 'Maid Style (White Stockings)', maidWhiteImage, '#7ab8ff', true),
  office: manifest('office', 'Office Style (Black Tights)', officeImage, '#8caeff', true),
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
