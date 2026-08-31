import type { MascotStyle } from '@shared/constants/mascot'
import { PET_MANIFESTS } from '@renderer/pet/manifests'

// Optional chaining is required for `--mode nomascot` builds, where
// `PET_MANIFESTS` is the empty stub: a missing look-up must yield `null`
// instead of throwing at module load (which would break the Settings view).
export const MASCOT_IMAGES: Record<MascotStyle, string | null> = {
  none: null,
  knowledge: PET_MANIFESTS.knowledge?.sprite ?? null,
  engineer: PET_MANIFESTS.engineer?.sprite ?? null,
  maid: PET_MANIFESTS.maid?.sprite ?? null,
  mature: PET_MANIFESTS.mature?.sprite ?? null,
  office: PET_MANIFESTS.office?.sprite ?? null,
  maidWhite: PET_MANIFESTS.maidWhite?.sprite ?? null,
  starshipCockpit: PET_MANIFESTS.starshipCockpit?.sprite ?? null,
  noirScholar: PET_MANIFESTS.noirScholar?.sprite ?? null,
  moonlitMaid: PET_MANIFESTS.moonlitMaid?.sprite ?? null
}
