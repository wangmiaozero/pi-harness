import { app, type BrowserWindow } from 'electron'

/** Only called for explicit user activation (Dock, pet menu, second instance). */
export function activateMainWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  const moveToCurrentDesktop = process.platform === 'darwin' && !window.isVisibleOnAllWorkspaces()
  if (moveToCurrentDesktop)
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
  if (window.isMinimized()) window.restore()
  app.focus({ steal: true })
  window.show()
  window.moveTop()
  window.focus()
  if (moveToCurrentDesktop)
    window.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true })
}
