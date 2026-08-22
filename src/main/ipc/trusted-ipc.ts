import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'

export type IpcHandleRegistrar = Pick<IpcMain, 'handle'>

/** Only the current application window's main frame may invoke privileged IPC. */
export function isTrustedIpcSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow | null
): boolean {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  )
}

/** Preserve Electron's handle API while applying one sender check to every channel. */
export function createTrustedIpcMain(
  source: IpcHandleRegistrar,
  getMainWindow: () => BrowserWindow | null,
  reject: () => unknown
): IpcHandleRegistrar {
  return {
    handle(channel, listener) {
      source.handle(channel, (event, ...args) => {
        if (!isTrustedIpcSender(event, getMainWindow())) return reject()
        return listener(event, ...args)
      })
    }
  }
}
