import { app } from 'electron'

/**
 * Accelerated 2D canvas uses Chromium SharedImage mailboxes. Resizing or
 * tearing down canvases (starfield, ai-motion) can leave the compositor with a
 * stale mailbox, which logs ProduceMemory / ProduceSkia / CopySharedImage
 * GL_INVALID_VALUE. Software 2D canvas avoids that path without disabling GPU
 * compositing for the rest of the UI.
 *
 * Windows additionally disables Chromium's native window occlusion tracking:
 * it frequently misreports occluded Electron windows (especially frameless
 * ones) and throttles or stalls their painting, which users perceive as the
 * whole app feeling "卡". The feature is a Chrome browser optimization with no
 * benefit inside a single Electron window.
 */
export function applyChromiumGpuWorkarounds(): void {
  const disabledFeatures = ['CanvasOopRasterization']
  if (process.platform === 'win32') {
    disabledFeatures.push('CalculateNativeWinOcclusion')
  }
  app.commandLine.appendSwitch('disable-accelerated-2d-canvas')
  app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','))
}
