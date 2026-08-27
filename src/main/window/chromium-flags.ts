import { app } from 'electron'

/**
 * Accelerated 2D canvas uses Chromium SharedImage mailboxes. Resizing or
 * tearing down canvases (starfield, ai-motion) can leave the compositor with a
 * stale mailbox, which logs ProduceMemory / ProduceSkia / CopySharedImage
 * GL_INVALID_VALUE. Software 2D canvas avoids that path without disabling GPU
 * compositing for the rest of the UI.
 */
export function applyChromiumGpuWorkarounds(): void {
  app.commandLine.appendSwitch('disable-accelerated-2d-canvas')
  app.commandLine.appendSwitch('disable-features', 'CanvasOopRasterization')
}
