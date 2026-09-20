/**
 * Platform boot: install `window.piSwitch` before the renderer app runs.
 *
 * Electron installs the bridge via the preload contextBridge, so nothing to
 * do there. Tauri has no preload; this module runs from a `<script>` tag that
 * precedes `main.ts` (see `src/renderer/index.html`) and awaits the dynamic
 * import so `window.piSwitch` exists before any renderer code touches it.
 */

import { isTauriHost } from './detect'

export async function bootDesktopPlatform(): Promise<void> {
  if (typeof window === 'undefined') return
  if (window.piSwitch) return // Electron preload already installed the bridge.

  if (isTauriHost()) {
    // Compile-time define `__TAURI_SHELL__` lets Rollup drop this branch
    // entirely in Electron builds (see electron.vite.config.ts).
    if (typeof __TAURI_SHELL__ !== 'undefined' && __TAURI_SHELL__) {
      const { createTauriBridge } = await import('./tauri')
      window.piSwitch = createTauriBridge()
    }
  }
  // No host at all: leave `window.piSwitch` unset. The renderer's `getApi()`
  // reports "desktop shell required" — same behaviour as opening the
  // Electron build in a plain browser.
}
