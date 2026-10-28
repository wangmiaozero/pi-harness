/// <reference types="vite/client" />

import type { PiSwitchPetAPI } from '@shared/ipc/api-types'

declare global {
  interface Window {
    /** Narrow pet-only bridge exposed by src/preload/pet.ts. */
    piSwitchPet?: PiSwitchPetAPI
  }
}

export {}
