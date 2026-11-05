import { MASCOT_ENABLED } from '@shared/feature-flags'
import { BUNDLED_PACK_ID } from '@shared/pet/desktop'

export interface BigfishStartupSettings {
  desktopPet?: {
    enabled?: boolean
    activePackId?: string
    reducedMotion?: boolean
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
