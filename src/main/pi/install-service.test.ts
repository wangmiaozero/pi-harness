import { beforeEach, describe, expect, it, vi } from 'vitest'

const piProcessMock = vi.hoisted(() => ({
  resolveCliPath: vi.fn(),
  version: vi.fn(),
  invalidateCache: vi.fn()
}))

vi.mock('../process/pi-process', () => ({ piProcess: piProcessMock }))

import { PI_INSTALL_ARGS, PI_INSTALL_COMMAND } from '@shared/constants/pi-install'
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

  it('uses the safe documented npm command for one-click installation', async () => {
    piProcessMock.resolveCliPath.mockResolvedValueOnce(null).mockResolvedValue('/tmp/bin/pi')
    piProcessMock.version.mockResolvedValue('0.84.2')
    const runCommand = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
    const service = new PiInstallService({
      resolveNpm: async () => '/tmp/bin/npm',
      runCommand
    })

    const result = await service.install()

    expect(PI_INSTALL_COMMAND).toBe(
      'npm install -g --ignore-scripts @earendil-works/pi-coding-agent'
    )
    expect(runCommand).toHaveBeenCalledWith('/tmp/bin/npm', [...PI_INSTALL_ARGS], 5 * 60_000)
    expect(result).toMatchObject({ ok: true, action: 'install', currentVersion: '0.84.2' })
  })

  it('requires Node.js and npm before one-click installation', async () => {
    piProcessMock.resolveCliPath.mockResolvedValue(null)
    const runCommand = vi.fn()
    const service = new PiInstallService({
      resolveNpm: async () => {
        throw new Error('missing')
      },
      runCommand
    })

    await expect(service.install()).rejects.toMatchObject({
      message: 'Node.js and npm are required before installing Pi'
    })
    expect(runCommand).not.toHaveBeenCalled()
  })
})
