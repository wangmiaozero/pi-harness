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
  it.each(['darwin', 'linux', 'win32'])(
    'disables accelerated canvas with the %s occlusion policy',
    (platform) => {
      const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
      Object.defineProperty(process, 'platform', { value: platform })
      try {
        applyChromiumGpuWorkarounds()
        expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-accelerated-2d-canvas')
        expect(app.commandLine.appendSwitch).toHaveBeenCalledWith(
          'disable-features',
          platform === 'win32'
            ? 'CanvasOopRasterization,CalculateNativeWinOcclusion'
            : 'CanvasOopRasterization'
        )
      } finally {
        Object.defineProperty(process, 'platform', descriptor)
      }
    }
  )
})
