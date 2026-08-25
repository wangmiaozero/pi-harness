import { describe, expect, it, vi } from 'vitest'
import { overlayBoundsForDisplay } from './screen-motion-overlay'

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  screen: {
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    getAllDisplays: vi.fn(() => [])
  }
}))

describe('screen motion overlay', () => {
  it('covers the full display bounds, including menu bar and dock regions', () => {
    expect(
      overlayBoundsForDisplay({
        bounds: { x: 1920, y: -120, width: 2560, height: 1440 }
      })
    ).toEqual({ x: 1920, y: -120, width: 2560, height: 1440 })
  })
})
