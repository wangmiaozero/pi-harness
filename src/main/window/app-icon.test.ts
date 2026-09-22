import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isPackaged: false,
  setDockIcon: vi.fn(),
  createFromPath: vi.fn(() => ({ isEmpty: () => false }))
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged
    },
    dock: { setIcon: mocks.setDockIcon }
  },
  nativeImage: { createFromPath: mocks.createFromPath }
}))

import { applyAppIcon, selectedAppIconPath } from './app-icon'

beforeEach(() => {
  mocks.isPackaged = false
  vi.clearAllMocks()
})

describe('application icon', () => {
  it('selects Ming only for active Ming themes and keeps a manual override', () => {
    expect(
      selectedAppIconPath({ appIcon: 'auto', mascotStyle: 'mingMoon', mascotUnlocked: true })
    ).toMatch(/ming\.png$/)
    expect(
      selectedAppIconPath({ appIcon: 'auto', mascotStyle: 'office', mascotUnlocked: true })
    ).toMatch(/classic\.png$/)
    expect(
      selectedAppIconPath({ appIcon: 'quantum', mascotStyle: 'mingSnow', mascotUnlocked: true })
    ).toMatch(/quantum\.png$/)
  })

  it('applies the selected image through the platform icon API', () => {
    const setWindowIcon = vi.fn()
    const window = { isDestroyed: () => false, setIcon: setWindowIcon }
    applyAppIcon(
      { appIcon: 'quantum', mascotStyle: 'none', mascotUnlocked: false },
      window as never
    )
    expect(mocks.createFromPath).toHaveBeenCalledWith(expect.stringMatching(/quantum\.png$/))
    if (process.platform === 'darwin') {
      expect(mocks.setDockIcon).toHaveBeenCalledOnce()
    } else {
      expect(setWindowIcon).toHaveBeenCalledOnce()
    }
  })
})
