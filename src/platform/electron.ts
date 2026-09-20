/**
 * Electron accessor for the platform layer. The preload contextBridge
 * already installs `window.piSwitch`; the platform layer just reads it.
 */

import type { PiSwitchAPI } from '@shared/ipc/api-types'

/** Returns the Electron-installed bridge, or `null` when absent. */
export function getElectronBridge(): PiSwitchAPI | null {
  return typeof window !== 'undefined' && window.piSwitch ? window.piSwitch : null
}
