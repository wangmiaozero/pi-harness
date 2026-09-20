/**
 * Compile-time flag injected via `define` in the build configs:
 * - `vite.tauri.config.ts` sets it to `true`
 * - `electron.vite.config.ts` sets it to `false` (lets Rollup drop the
 *   Tauri bridge import from Electron bundles)
 * - `vitest.config.ts` sets it to `true` (bridge tests run against the mock)
 *
 * Declared `boolean | undefined` with a runtime fallback so accidental
 * plain-tsc usage (no define) degrades instead of crashing.
 */
declare const __TAURI_SHELL__: boolean | undefined
