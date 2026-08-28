import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const piProcessMock = vi.hoisted(() => ({
  resolveCliPath: vi.fn(),
  version: vi.fn(),
  invalidateCache: vi.fn()
}))

vi.mock('../process/pi-process', () => ({ piProcess: piProcessMock }))

import { PI_INSTALL_ARGS, PI_INSTALL_COMMAND } from '@shared/constants/pi-install'
import { PI_NPM_PACKAGE, PiInstallService } from './install-service'
import { EnvironmentError } from '../services/errors'

const readyRuntime = {
  nodeInstalled: true,
  nodeSupported: true,
  nodePath: '/tmp/bin/node',
  nodeVersion: 'v24.15.0',
  npmInstalled: true,
  npmPath: '/tmp/bin/npm',
  npmVersion: '11.0.0'
} as never

const writablePrefix = {
  prefix: '/tmp/npm-global',
  binDir: '/tmp/npm-global/bin',
  writable: true,
  changed: false,
  previousPrefix: '/tmp/npm-global',
  env: { PATH: '/tmp/bin:/tmp/npm-global/bin' }
}

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
      detectRuntime: async () => readyRuntime,
      ensurePrefix: async () => writablePrefix,
      refreshPath: async () => '/tmp/bin:/tmp/npm-global/bin',
      runCommand
    })

    const result = await service.install()

    expect(PI_INSTALL_COMMAND).toBe(
      'npm install -g --ignore-scripts @earendil-works/pi-coding-agent'
    )
    expect(runCommand).toHaveBeenCalledWith(
      '/tmp/bin/npm',
      [...PI_INSTALL_ARGS],
      expect.objectContaining({ timeoutMs: 10 * 60_000 })
    )
    expect(result).toMatchObject({ ok: true, action: 'install', currentVersion: '0.84.2' })
  })

  it('requires Node.js and npm before one-click installation', async () => {
    piProcessMock.resolveCliPath.mockResolvedValue(null)
    const runCommand = vi.fn()
    const service = new PiInstallService({
      detectRuntime: async () =>
        ({ nodeInstalled: false, nodeSupported: false, npmInstalled: false }) as never,
      runCommand
    })

    await expect(service.install()).rejects.toMatchObject({
      code: 'NODE_NOT_FOUND'
    })
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('finds Pi from the npm prefix after refreshing PATH', async () => {
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-pi-prefix-'))
    const binDir = path.join(sandbox, 'bin')
    const piPath = path.join(binDir, process.platform === 'win32' ? 'pi.cmd' : 'pi')
    await fs.mkdir(binDir, { recursive: true })
    await fs.writeFile(piPath, '#!/bin/sh\n')
    await fs.chmod(piPath, 0o755)
    piProcessMock.resolveCliPath.mockResolvedValue(null)
    piProcessMock.version.mockResolvedValue('0.84.2')
    const runCommand = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
    const refreshPath = vi.fn().mockResolvedValue(`${binDir}:/tmp/bin`)
    const service = new PiInstallService({
      detectRuntime: async () => readyRuntime,
      ensurePrefix: async () => ({ ...writablePrefix, prefix: sandbox, binDir }),
      refreshPath,
      runCommand
    })

    try {
      await expect(service.install()).resolves.toMatchObject({ currentVersion: '0.84.2' })
      expect(refreshPath).toHaveBeenCalledWith(['/tmp/bin', binDir])
    } finally {
      await fs.rm(sandbox, { recursive: true, force: true })
    }
  })

  it('classifies npm EACCES without attempting sudo', async () => {
    piProcessMock.resolveCliPath.mockResolvedValue(null)
    const runCommand = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'npm ERR! code EACCES\npermission denied',
      exitCode: 243,
      signal: null
    })
    const service = new PiInstallService({
      detectRuntime: async () => readyRuntime,
      ensurePrefix: async () => writablePrefix,
      runCommand
    })

    await expect(service.install()).rejects.toMatchObject({ code: 'NPM_PERMISSION_DENIED' })
    expect(runCommand.mock.calls.flat(Infinity)).not.toContain('sudo')
  })

  it('classifies a vanished npm executable as repairable NPM_NOT_FOUND', async () => {
    piProcessMock.resolveCliPath.mockResolvedValue(null)
    const service = new PiInstallService({
      detectRuntime: async () => readyRuntime,
      ensurePrefix: async () => writablePrefix,
      runCommand: async () => {
        throw new EnvironmentError('COMMAND_FAILED', 'Failed to start npm', { code: 'ENOENT' })
      }
    })

    await expect(service.install()).rejects.toMatchObject({ code: 'NPM_NOT_FOUND' })
  })

  it('updates a project-local Pi through the writable npm prefix', async () => {
    const localPi = path.join('/workspace', 'node_modules', '.bin', 'pi.cmd')
    const installedPi = path.join('/tmp', 'npm-global', 'bin', 'pi.cmd')
    piProcessMock.resolveCliPath
      .mockResolvedValueOnce(localPi)
      .mockResolvedValueOnce(localPi)
      .mockResolvedValueOnce(installedPi)
    piProcessMock.version
      .mockResolvedValueOnce('0.84.2')
      .mockResolvedValueOnce('0.84.2')
      .mockResolvedValueOnce('0.85.0')
    const runCommand = vi.fn().mockResolvedValue({ stdout: 'updated', stderr: '', exitCode: 0 })
    const onLog = vi.fn()
    const service = new PiInstallService({
      detectRuntime: async () => readyRuntime,
      ensurePrefix: async () => writablePrefix,
      refreshPath: async () => '/tmp/bin:/tmp/npm-global/bin',
      runCommand
    })

    const result = await service.update(false, { onLog })

    expect(runCommand).toHaveBeenCalledWith(
      '/tmp/bin/npm',
      [...PI_INSTALL_ARGS],
      expect.objectContaining({ timeoutMs: 10 * 60_000 })
    )
    expect(runCommand.mock.calls.flat(Infinity)).not.toContain('--self')
    expect(onLog).toHaveBeenCalledWith(
      expect.stringContaining('belongs to this project'),
      'warning'
    )
    expect(result).toMatchObject({
      action: 'update',
      previousVersion: '0.84.2',
      currentVersion: '0.85.0'
    })
  })

  it('streams self-update output and progress for a global Pi installation', async () => {
    piProcessMock.resolveCliPath.mockResolvedValue('/tmp/bin/pi')
    piProcessMock.version.mockResolvedValueOnce('0.84.2').mockResolvedValueOnce('0.85.0')
    const onLog = vi.fn()
    const onProgress = vi.fn()
    const runCommand = vi.fn(async (_executable, _args, options) => {
      options.onStdout?.('downloading\n')
      options.onStderr?.('update warning\n')
      return { stdout: 'downloading\n', stderr: 'update warning\n', exitCode: 0, signal: null }
    })
    const service = new PiInstallService({
      detectRuntime: async () => readyRuntime,
      runCommand
    })

    await expect(service.update(false, { onLog, onProgress })).resolves.toMatchObject({
      action: 'update',
      currentVersion: '0.85.0'
    })

    expect(runCommand).toHaveBeenCalledWith(
      '/tmp/bin/pi',
      ['update', '--self'],
      expect.objectContaining({ timeoutMs: 5 * 60_000 })
    )
    expect(onLog).toHaveBeenCalledWith('downloading', 'stdout')
    expect(onLog).toHaveBeenCalledWith('update warning', 'stderr')
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ progress: 90 }))
  })

  it('exposes the resolved Node runtime so pi self-update can spawn npm', async () => {
    piProcessMock.resolveCliPath.mockResolvedValue('/tmp/npm-global/bin/pi')
    piProcessMock.version.mockResolvedValueOnce('0.84.2').mockResolvedValueOnce('0.85.0')
    const runCommand = vi
      .fn()
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, signal: null })
    const launchServicePath = process.env.PATH
    const service = new PiInstallService({
      detectRuntime: async () =>
        ({
          nodePath: '/tmp/pi-harness-runtime/bin/node',
          npmPath: '/tmp/pi-harness-runtime/bin/npm'
        }) as never,
      runCommand
    })

    try {
      // Simulate a GUI launch whose PATH has no Node/npm.
      process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
      await service.update(false)
    } finally {
      process.env.PATH = launchServicePath
    }

    const env = runCommand.mock.calls[0][2]?.env ?? {}
    const pathEntries = String(env.PATH ?? '').split(path.delimiter)
    expect(pathEntries[0]).toBe('/tmp/pi-harness-runtime/bin')
    expect(pathEntries).not.toContain('/usr/local/bin')
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('sets ELECTRON_RUN_AS_NODE for a JavaScript CLI entrypoint', async () => {
    const cliJs = path.join('/tmp', 'npm-global', 'lib', 'node_modules', 'pi', 'dist', 'cli.js')
    piProcessMock.resolveCliPath.mockResolvedValue(cliJs)
    piProcessMock.version.mockResolvedValueOnce('0.84.2').mockResolvedValueOnce('0.85.0')
    const runCommand = vi
      .fn()
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, signal: null })
    const service = new PiInstallService({
      detectRuntime: async () => readyRuntime,
      runCommand
    })

    await service.update(false)

    expect(runCommand).toHaveBeenCalledWith(
      process.execPath,
      [cliJs, 'update', '--self'],
      expect.objectContaining({
        env: expect.objectContaining({
          ELECTRON_RUN_AS_NODE: '1',
          PATH: expect.stringContaining('/tmp/bin')
        })
      })
    )
  })
})
