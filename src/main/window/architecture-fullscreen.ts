import type { BrowserWindow } from 'electron'

/** Own the architecture document's screen transition and preserve prior window mode. */
export function installArchitectureFullscreen(win: BrowserWindow): void {
  // Other platforms use Electron's HTML fullscreen ownership and restoration.
  // Only macOS needs a custom transition to remain in the current Space.
  if (process.platform !== 'darwin') return
  let version = 0
  let restore: (() => void) | null = null
  win.webContents.on('enter-html-full-screen', () => {
    const ticket = ++version
    void win.webContents
      .executeJavaScript(
        `new Promise(resolve => {
        const check = () => resolve(document.fullscreenElement?.id === 'pi-architecture-panel');
        if (document.fullscreenElement) check();
        else document.addEventListener('fullscreenchange', check, { once: true });
      })`
      )
      .then((architecture) => {
        if (!architecture || win.isDestroyed() || ticket !== version) return
        if (win.isFullScreen() || win.isSimpleFullScreen()) return
        // Instant screen filling on macOS avoids moving the project into a new
        // Space, and lets the diagram retain its camera through the transition.
        win.setSimpleFullScreen(true)
        restore = () => win.setSimpleFullScreen(false)
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
