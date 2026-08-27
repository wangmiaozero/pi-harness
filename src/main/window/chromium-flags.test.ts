import { describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { applyChromiumGpuWorkarounds } from './chromium-flags'

vi.mock('electron', () => ({
  app: {
    commandLine: {
      appendSwitch: vi.fn()
    }
  }
}))

describe('chromium GPU workarounds', () => {
  it('disables accelerated 2D canvas SharedImage rasterization', () => {
    applyChromiumGpuWorkarounds()
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-accelerated-2d-canvas')
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith(
      'disable-features',
      'CanvasOopRasterization'
    )
  })
})
