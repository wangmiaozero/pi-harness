import type { PetManifest, PetThemeId } from '@shared/pet/types'

/**
 * Build-time stand-in for `manifests-data`, selected via the renderer alias in
 * electron.vite.config.ts when building with `--mode nomascot`. Intentionally
 * empty: every look-up misses, no mascot renders, and the sprite PNGs never
 * enter the bundle.
 */
export const PET_THEME_ORDER: readonly PetThemeId[] = []

// Deliberate type assertion: the real record is complete, the stub is not.
export const PET_MANIFESTS = {} as Readonly<Record<PetThemeId, PetManifest>>
