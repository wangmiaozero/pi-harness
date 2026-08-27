import type { MascotStyle } from '@shared/constants/mascot'
import { PET_MANIFESTS } from '@renderer/pet/manifests'

export const MASCOT_IMAGES: Record<MascotStyle, string | null> = {
  none: null,
  knowledge: PET_MANIFESTS.knowledge.sprite,
  engineer: PET_MANIFESTS.engineer.sprite,
  maid: PET_MANIFESTS.maid.sprite,
  mature: PET_MANIFESTS.mature.sprite,
  office: PET_MANIFESTS.office.sprite,
  maidWhite: PET_MANIFESTS.maidWhite.sprite,
  starshipCockpit: PET_MANIFESTS.starshipCockpit.sprite
}
