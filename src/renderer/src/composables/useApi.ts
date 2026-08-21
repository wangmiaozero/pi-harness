/**
 * Typed IPC accessor for the Electron desktop shell.
 * There is no browser / Vite-only mock — Pi-Harness is desktop-only.
 */

import type { PiSwitchAPI, IpcError } from '@shared/ipc/api-types'
import type { AppErrorPayload } from '@shared/types/errors'
import { isErrorPayload } from '@shared/types/errors'

export function isBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.piSwitch !== 'undefined'
}

export function getApi(): PiSwitchAPI {
  if (!isBridgeAvailable() || !window.piSwitch) {
    throw Object.assign(
      new Error(
        'Pi-Harness IPC bridge unavailable. Launch via Electron (`pnpm dev`), not a browser.'
      ),
      {
        payload: {
          code: 'IPC_ERROR',
          message: 'Pi-Harness IPC bridge unavailable. Desktop shell required.'
        } satisfies AppErrorPayload
      }
    )
  }
  return window.piSwitch
}

export function isIpcError(error: unknown): error is IpcError {
  return error instanceof Error && 'payload' in error && isErrorPayload((error as IpcError).payload)
}

export function getErrorPayload(error: unknown): AppErrorPayload {
  if (isIpcError(error)) return error.payload
  if (isErrorPayload(error)) return error
  if (error instanceof Error) {
    return { code: 'APP_ERROR', message: error.message }
  }
  return { code: 'APP_ERROR', message: String(error) }
}

export function useApi() {
  return {
    api: getApi(),
    bridgeAvailable: isBridgeAvailable(),
    getErrorPayload,
    isIpcError
  }
}

export async function callApi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw getErrorPayload(error)
  }
}
