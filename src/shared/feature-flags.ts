/**
 * Compile-time feature flags, injected via `define` in electron.vite.config.ts
 * (and vitest.config.ts). Building with `--mode nomascot` sets the mascot flag
 * to `false` and swaps in `pet/manifests-stub` for `pet/manifests-data`, which
 * keeps the mascot module and its sprite assets out of the packaged app.
 */
declare const __MASCOT_ENABLED__: boolean | undefined

/** True unless the app was compiled with `--mode nomascot`. */
export const MASCOT_ENABLED: boolean =
  typeof __MASCOT_ENABLED__ === 'undefined' ? true : __MASCOT_ENABLED__ !== false
