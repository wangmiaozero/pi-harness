/**
 * Compile-time feature flags, injected via `define` in electron.vite.config.ts
 * (and vitest.config.ts). Theme artwork and desktop pets are optional packs
 * installed by the user.
 */
declare const __MASCOT_ENABLED__: boolean | undefined

export const MASCOT_ENABLED: boolean =
  typeof __MASCOT_ENABLED__ === 'undefined' ? true : __MASCOT_ENABLED__ !== false
