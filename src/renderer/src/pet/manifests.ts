import type { MascotStyle } from '@shared/constants/mascot'
import type { PetManifest } from '@shared/pet/types'

// Imported through the alias path (not a relative './manifests-data') so that
// `--mode nomascot` builds can rewrite it to `manifests-stub` in
// electron.vite.config.ts and drop the mascot sprite assets from the bundle.
import { PET_MANIFESTS, PET_THEME_ORDER } from '@renderer/pet/manifests-data'

export { PET_MANIFESTS, PET_THEME_ORDER }

export function getPetManifest(style: MascotStyle): PetManifest | null {
  return style === 'none' ? null : (PET_MANIFESTS[style] ?? null)
}
