import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const { focus } = vi.hoisted(() => ({ focus: vi.fn() }))
vi.mock('electron', () => ({ app: { focus } }))
import { activateMainWindow } from './activate-main'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('explicit main window activation', () => {
  it.each(['darwin', 'win32', 'linux'])('restores and raises the main window on %s', (platform) => {
    vi.stubGlobal('process', { ...process, platform })
    const calls: string[] = []
    const win = {
      isDestroyed: () => false,
      isMinimized: () => true,
      isVisibleOnAllWorkspaces: () => false,
      setVisibleOnAllWorkspaces: vi.fn(),
      restore: () => calls.push('restore'),
      show: () => calls.push('show'),
      moveTop: () => calls.push('moveTop'),
      focus: () => calls.push('focus')
    }
    activateMainWindow(win as unknown as BrowserWindow)
    expect(calls).toEqual(['restore', 'show', 'moveTop', 'focus'])
    expect(focus).toHaveBeenCalledWith({ steal: true })
    if (platform === 'darwin') {
      expect(win.setVisibleOnAllWorkspaces).toHaveBeenNthCalledWith(1, true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      })
      expect(win.setVisibleOnAllWorkspaces).toHaveBeenNthCalledWith(2, false, {
        skipTransformProcessType: true
      })
    } else expect(win.setVisibleOnAllWorkspaces).not.toHaveBeenCalled()
  })
  it('ignores destroyed windows', () => {
    activateMainWindow({ isDestroyed: () => true } as BrowserWindow)
    expect(focus).not.toHaveBeenCalled()
  })
})
