import type { BrowserWindow } from 'electron'

/** Own the architecture document's screen transition and preserve prior window mode. */
export function installArchitectureFullscreen(win: BrowserWindow): void {
  let version = 0
  let restore: (() => void) | null = null
  win.webContents.on('enter-html-full-screen', () => {
    const ticket = ++version
    void win.webContents
      .executeJavaScript("document.fullscreenElement?.id==='pi-architecture-panel'")
      .then((architecture) => {
        if (!architecture || win.isDestroyed() || ticket !== version) return
        if (win.isFullScreen() || (process.platform === 'darwin' && win.isSimpleFullScreen()))
          return
        // Instant screen filling on macOS avoids moving the project into a new
        // Space, and lets the diagram retain its camera through the transition.
        if (process.platform === 'darwin') {
          win.setSimpleFullScreen(true)
          restore = () => win.setSimpleFullScreen(false)
        } else {
          win.setFullScreen(true)
          restore = () => win.setFullScreen(false)
        }
      })
      .catch(() => undefined)
  })
  win.webContents.on('leave-html-full-screen', () => {
    version++
    const action = restore
    restore = null
    if (!win.isDestroyed()) action?.()
  })
  win.on('closed', () => {
    version++
    restore = null
  })
}
