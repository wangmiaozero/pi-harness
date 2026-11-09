import type { MascotStyle } from '@shared/constants/mascot'
import type { PetManifest } from '@shared/pet/types'

import { PET_MANIFESTS, PET_THEME_ORDER } from '@renderer/pet/manifests-data'

export { PET_MANIFESTS, PET_THEME_ORDER }

export function getPetManifest(style: MascotStyle): PetManifest | null {
  return style === 'none' ? null : (PET_MANIFESTS[style] ?? null)
}
