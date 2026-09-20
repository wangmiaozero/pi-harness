/**
 * Host detection and error helpers for the platform layer.
 *
 * Detection is runtime-based: Tauri injects `__TAURI_INTERNALS__` into the
 * webview before any user script runs. No compile-time coupling.
 */

import type { AppErrorPayload } from '@shared/types/errors'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

/** True when running inside the Tauri desktop host. */
export function isTauriHost(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** True when running inside the Electron desktop host (preload present). */
export function isElectronHost(): boolean {
  return typeof window !== 'undefined' && typeof window.piSwitch !== 'undefined'
}

/**
 * Error code for methods the Tauri shell has not wired up yet. The renderer's
 * existing error pipeline (`getErrorPayload`) understands plain payload
 * objects, so rejected promises carry exactly this shape.
 */
export const SHELL_METHOD_PENDING = 'SHELL_METHOD_PENDING' as const

export interface PendingMethodPayload extends AppErrorPayload {
  code: typeof SHELL_METHOD_PENDING
}

/**
 * Rejected-promise payload used by every `piSwitch` method that the Tauri
 * shell has not implemented yet. Message wording is user-facing on purpose:
 * renderer toasts fall back to `message` when no `userMessage` is set.
 */
export function pendingMethodPayload(namespace: string, method: string): PendingMethodPayload {
  return {
    code: SHELL_METHOD_PENDING,
    message: `This feature is not wired into the Tauri shell yet (${namespace}.${method}).`,
    userMessage: '此功能尚未接入 Tauri 外壳，暂时请使用 Electron 版本。',
    recoverable: false,
    context: { namespace, method }
  }
}

/** Rejected promise carrier for a not-yet-implemented method. */
export function pendingMethod<T>(namespace: string, method: string): Promise<T> {
  return Promise.reject(pendingMethodPayload(namespace, method))
}
