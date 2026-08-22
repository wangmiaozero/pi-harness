import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron'
import { createTrustedIpcMain, isTrustedIpcSender } from './trusted-ipc'

function fixture() {
  const mainFrame = { name: 'main' }
  const webContents = {
    isDestroyed: () => false,
    mainFrame
  } as unknown as WebContents
  const window = {
    isDestroyed: () => false,
    webContents
  } as unknown as BrowserWindow
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent
  return { event, mainFrame, webContents, window }
}

describe('trusted IPC sender', () => {
  it('accepts only the current main window main frame', () => {
    const { event, window, webContents } = fixture()

    expect(isTrustedIpcSender(event, window)).toBe(true)
    expect(
      isTrustedIpcSender(
        { ...event, senderFrame: { name: 'child' } } as unknown as IpcMainInvokeEvent,
        window
      )
    ).toBe(false)
    expect(
      isTrustedIpcSender(
        { ...event, sender: {} as WebContents } as unknown as IpcMainInvokeEvent,
        window
      )
    ).toBe(false)
    expect(isTrustedIpcSender(event, null)).toBe(false)
    expect(webContents.isDestroyed()).toBe(false)
  })

  it('rejects an untrusted call before the channel listener runs', async () => {
    const { event, window } = fixture()
    let registered: ((event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) | undefined
    const source = {
      handle: vi.fn((_channel: string, listener: typeof registered) => {
        registered = listener
      })
    }
    const listener = vi.fn(() => 'ok')
    const reject = vi.fn(() => 'rejected')
    const trusted = createTrustedIpcMain(source as never, () => window, reject)
    trusted.handle('channel', listener)

    expect(await registered?.(event, 'value')).toBe('ok')
    expect(listener).toHaveBeenCalledWith(event, 'value')

    const otherEvent = { ...event, senderFrame: {} } as unknown as IpcMainInvokeEvent
    expect(await registered?.(otherEvent)).toBe('rejected')
    expect(reject).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledOnce()
  })
})
