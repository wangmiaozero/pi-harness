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
import { resolveExecutable, type ResolvedExecutable } from '../environment/command-resolver'

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

  it.each([false, true])(
    'updates the terminal npm prefix even when the bundled version is current (force=%s)',
    async (force) => {
      const prefix = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal pi npm-'))
      const windows = process.platform === 'win32'
      const legacy = '@mariozechner/pi-coding-agent'
      const bin = windows ? prefix : path.join(prefix, 'bin')
      const launcher = path.join(bin, windows ? 'pi.cmd' : 'pi')
      try {
        const entry = windows
          ? launcher
          : path.join(prefix, 'lib', 'node_modules', legacy, 'dist', 'cli.js')
        const writeVersion = (version: string) =>
          fs.writeFile(
            entry,
            windows
              ? `@rem "%dp0%\\node_modules\\${legacy.replace('/', '\\')}\\dist\\cli.js"\r\n@echo ${version}\r\n`
              : `#!/bin/sh\nprintf '%s\\n' '${version}'\n`,
            { mode: 0o755 }
          )
        await fs.mkdir(path.dirname(entry), { recursive: true })
        await writeVersion('0.8.0')
        if (!windows) {
          await fs.mkdir(bin)
          await fs.symlink(entry, launcher)
        }
        const resolveTerminal = async () => {
          const env = { PATH: bin }
          return { pi: await resolveExecutable('pi', { env, pathOnly: true }), env }
        }
        const runCommand = vi.fn(async (_command: string, _args: string[]) => {
          await writeVersion('1.6.0')
          return { exitCode: 0, stdout: '', stderr: '', signal: null }
        })
        const service = new PiInstallService({
          detectRuntime: async () => readyRuntime,
          resolveTerminal,
          runCommand
        })

        await expect(service.maintainTerminal('1.6.0', { force }, '/bundled/pi')).resolves.toEqual({
          previousVersion: '0.8.0',
          currentVersion: '1.6.0'
        })
        expect(runCommand).toHaveBeenCalledWith(
          '/tmp/bin/npm',
          ['install', '-g', '--ignore-scripts', '--force', `${PI_NPM_PACKAGE}@1.6.0`],
          expect.objectContaining({ env: expect.objectContaining({ NPM_CONFIG_PREFIX: prefix }) })
        )
        expect(piProcessMock.resolveCliPath).not.toHaveBeenCalled()
      } finally {
        await fs.rm(prefix, { recursive: true, force: true })
      }
    }
  )

  it('rejects an apparently successful update when the terminal still resolves an old Pi', async () => {
    const launcher = path.join(os.tmpdir(), 'old-terminal', 'pi')
    const resolveTerminal = vi.fn().mockResolvedValue(terminalFixture(launcher, '0.8.0'))
    const runCommand = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    const service = new PiInstallService({ resolveTerminal, runCommand })

    await expect(service.maintainTerminal('1.6.0')).rejects.toMatchObject({
      code: 'PI_NOT_FOUND_AFTER_INSTALL',
      message: expect.stringContaining('Terminal still resolves Pi 0.8.0')
    })
    expect(runCommand).toHaveBeenCalledWith(launcher, ['update', '--self'], expect.anything())
  })

  it('leaves the terminal alone when there is no existing Pi on its PATH', async () => {
    const resolveTerminal = vi.fn().mockResolvedValue(terminalFixture(null, null))
    const runCommand = vi.fn()
    const service = new PiInstallService({ resolveTerminal, runCommand })

    await expect(service.maintainTerminal('1.6.0', { force: true })).resolves.toBeNull()
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('does not treat the bundled executable on PATH as a separate installation', async () => {
    const bundledPath = path.join(os.tmpdir(), 'bundled', 'pi')
    const resolveTerminal = vi.fn().mockResolvedValue(terminalFixture(bundledPath, '1.6.0'))
    const runCommand = vi.fn()
    const service = new PiInstallService({ resolveTerminal, runCommand })

    await expect(service.getTerminalInstallation(bundledPath)).resolves.toBeNull()
    await expect(
      service.maintainTerminal('1.6.0', { force: true }, bundledPath)
    ).resolves.toBeNull()
    expect(runCommand).not.toHaveBeenCalled()
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

  it('checks registry updates with the detected Node ahead of a different npm directory', async () => {
    piProcessMock.resolveCliPath.mockResolvedValue('/tmp/pi')
    piProcessMock.version.mockResolvedValue('0.84.2')
    const nodeBin = path.join(os.tmpdir(), 'active node', 'bin')
    const npmBin = path.join(os.tmpdir(), 'other npm', 'bin')
    const runCommand = vi.fn().mockResolvedValue({
      stdout: '"0.85.0"',
      stderr: '',
      exitCode: 0
    })
    const service = new PiInstallService({
      detectRuntime: async () =>
        ({
          nodeSupported: true,
          nodePath: path.join(nodeBin, 'node'),
          npmPath: path.join(npmBin, 'npm'),
          resolvedPath: process.env.PATH
        }) as never,
      runCommand
    })

    expect(await service.checkLatest()).toMatchObject({
      updateAvailable: true,
      latestVersion: '0.85.0'
    })
    expect(runCommand.mock.calls[0][2].env.PATH.split(path.delimiter).slice(0, 2)).toEqual([
      nodeBin,
      npmBin
    ])
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
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('managed by npm'), 'warning')
    expect(result).toMatchObject({
      action: 'update',
      previousVersion: '0.84.2',
      currentVersion: '0.85.0'
    })
  })

  it('updates an npm-global JavaScript installation through npm', async () => {
    const npmPi = path.join(
      '/tmp',
      'npm-global',
      'lib',
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'dist',
      'cli.js'
    )
    piProcessMock.resolveCliPath.mockResolvedValue(npmPi)
    piProcessMock.version
      .mockResolvedValueOnce('0.85.1')
      .mockResolvedValueOnce('0.85.1')
      .mockResolvedValueOnce('0.86.0')
    const runCommand = vi.fn().mockResolvedValue({ stdout: 'updated', stderr: '', exitCode: 0 })
    const onLog = vi.fn()
    const service = new PiInstallService({
      detectRuntime: async () => readyRuntime,
      ensurePrefix: async () => writablePrefix,
      refreshPath: async () => '/tmp/bin:/tmp/npm-global/bin',
      runCommand
    })

    const result = await service.update(false, { onLog })

    expect(runCommand).toHaveBeenCalledOnce()
    expect(runCommand).toHaveBeenCalledWith(
      '/tmp/bin/npm',
      [...PI_INSTALL_ARGS],
      expect.objectContaining({ timeoutMs: 10 * 60_000 })
    )
    expect(runCommand.mock.calls.flat(Infinity)).not.toContain('--self')
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('managed by npm'), 'warning')
    expect(result).toMatchObject({
      action: 'update',
      previousVersion: '0.85.1',
      currentVersion: '0.86.0'
    })
  })

  it('falls back to npm when Pi refuses self-update for its installation source', async () => {
    piProcessMock.resolveCliPath
      .mockResolvedValueOnce('/tmp/bin/pi')
      .mockResolvedValueOnce('/tmp/bin/pi')
      .mockResolvedValueOnce('/tmp/npm-global/bin/pi')
    piProcessMock.version
      .mockResolvedValueOnce('0.85.1')
      .mockResolvedValueOnce('0.85.1')
      .mockResolvedValueOnce('0.86.0')
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: '',
        stderr:
          'error: pi cannot self-update this installation. This installation is not managed by a global pnpm install.',
        exitCode: 1
      })
      .mockResolvedValueOnce({ stdout: 'updated', stderr: '', exitCode: 0 })
    const onLog = vi.fn()
    const service = new PiInstallService({
      detectRuntime: async () => readyRuntime,
      ensurePrefix: async () => writablePrefix,
      refreshPath: async () => '/tmp/bin:/tmp/npm-global/bin',
      runCommand
    })

    const result = await service.update(false, { onLog })

    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      '/tmp/bin/pi',
      ['update', '--self'],
      expect.objectContaining({ timeoutMs: 5 * 60_000 })
    )
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      '/tmp/bin/npm',
      [...PI_INSTALL_ARGS],
      expect.objectContaining({ timeoutMs: 10 * 60_000 })
    )
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('retrying with npm'), 'warning')
    expect(result).toMatchObject({
      action: 'update',
      previousVersion: '0.85.1',
      currentVersion: '0.86.0'
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
          npmPath: '/tmp/other-npm/bin/npm'
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
    expect(pathEntries[1]).toBe('/tmp/other-npm/bin')
    expect(pathEntries).not.toContain('/usr/local/bin')
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('uses the resolved external Node for a JavaScript CLI entrypoint', async () => {
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
      '/tmp/bin/node',
      [cliJs, 'update', '--self'],
      expect.objectContaining({
        env: expect.objectContaining({
          ELECTRON_RUN_AS_NODE: undefined,
          PATH: expect.stringContaining('/tmp/bin')
        })
      })
    )
  })
})

function terminalFixture(launcher: string | null, version: string | null) {
  const pi: ResolvedExecutable = {
    command: 'pi',
    found: launcher !== null,
    path: launcher,
    source: launcher ? 'process-path' : null,
    version
  }
  return { pi, env: { PATH: launcher ? path.dirname(launcher) : '' } }
}
