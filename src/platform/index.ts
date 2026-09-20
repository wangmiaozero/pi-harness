/**
 * Platform layer — the renderer's single desktop-host seam.
 *
 * `window.piSwitch` is the API contract (see `@shared/ipc/api-types`).
 * Electron installs it via the preload contextBridge; the Tauri host
 * installs an equivalent bridge at boot (`boot.ts` + `tauri.ts`). Renderer
 * code never calls `invoke()`/`listen()` directly.
 *
 * Layout:
 * - `detect.ts`   — host detection + SHELL_METHOD_PENDING error payloads
 * - `boot.ts`     — one-shot bridge installation (Tauri only)
 * - `tauri.ts`    — Tauri implementation of the piSwitch contract
 * - `electron.ts` — Electron accessor (preload owns the real bridge)
 * - `types.ts`    — runtime extension types (Tauri-only namespace)
 *
 * `__TAURI_SHELL__` is defined per build target: `true` for
 * `vite.tauri.config.ts`, `false` for `electron.vite.config.ts`.
 */

export { isTauriHost, isElectronHost } from './detect'
export { bootDesktopPlatform } from './boot'
export type {
  PlatformRuntimeApi,
  PiSwitchTauriAPI,
  RuntimePhase,
  RuntimeStatus,
  RuntimeVersionResult,
  RuntimePingResult,
  RuntimeStateEvent,
  RuntimeRuntimeEvent,
  RuntimeLogEvent
} from './types'
