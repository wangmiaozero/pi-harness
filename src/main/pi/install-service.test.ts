import { beforeEach, describe, expect, it, vi } from 'vitest'

const piProcessMock = vi.hoisted(() => ({
  resolveCliPath: vi.fn(),
  version: vi.fn()
}))

vi.mock('../process/pi-process', () => ({ piProcess: piProcessMock }))

import { PI_NPM_PACKAGE, PiInstallService } from './install-service'

describe('PiInstallService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not query npm when Pi is not installed', async () => {
    piProcessMock.resolveCliPath.mockResolvedValue(null)

    const result = await new PiInstallService().checkLatest()

    expect(result).toEqual({
      installed: false,
      installedVersion: null,
      latestVersion: null,
      updateAvailable: false,
      packageName: PI_NPM_PACKAGE
    })
    expect(piProcessMock.version).not.toHaveBeenCalled()
  })
})
