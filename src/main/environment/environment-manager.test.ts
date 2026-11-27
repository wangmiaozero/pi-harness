import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, PiEnvironment, PiInstallResult } from '@shared/ipc/api-types'
import type { JsonStore } from '../services/storage'
import { EnvironmentError } from '../services/errors'
import { isNodeVersionSupported } from '../pi/node-environment'
import { setRuntimeProvider, type RuntimeProvider } from '../runtime/active'
import { catalog } from '../runtime/distribution.mjs'
import type { ResolvedRuntime } from '@shared/runtime/schema'

const piProcessMock = vi.hoisted(() => ({ invalidateCache: vi.fn() }))
vi.mock('../process/pi-process', () => ({ piProcess: piProcessMock }))

import { EnvironmentManager } from './environment-manager'

const installResult: PiInstallResult = {
  ok: true,
  action: 'install',
  previousVersion: null,
  currentVersion: '0.84.2',
  latestVersion: null,
  message: 'Installed Pi 0.84.2',
  log: 'npm install'
}

const updateResult: PiInstallResult = {
  ...installResult,
  action: 'update',
  previousVersion: '0.84.1',
  message: 'Updated Pi 0.84.1 → 0.84.2'
}

describe('EnvironmentManager', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => setRuntimeProvider(null))

  it.each(['update', 'reinstall'] as const)(
    'limits %s to the selected terminal installation',
    async (action) => {
      const { provider, runtime } = useBundledPi()
      const fixture = managerFixture({ nodeVersion: 'v24.22.1', piReady: true })
      fixture.piInstaller.maintainTerminal.mockResolvedValue({
        previousVersion: '0.8.0',
        currentVersion: runtime.version
      })

      const result =
        action === 'update'
          ? fixture.manager.updatePi(false, 'terminal')
          : fixture.manager.reinstallPi('terminal')
      await expect(result).resolves.toMatchObject({
        previousVersion: '0.8.0',
        currentVersion: runtime.version,
        ok: true
      })
      expect(provider.update).not.toHaveBeenCalled()
      expect(fixture.piInstaller.maintainTerminal).toHaveBeenCalledWith(
        runtime.version,
        expect.objectContaining({ force: action === 'reinstall' }),
        runtime.executablePath
      )
      expect(fixture.manager.getTask()).toMatchObject({ state: 'success', progress: 100 })
    }
  )

  it.each(['updatePi', 'reinstallPi'] as const)(
    'only updates bundled Pi when %s has no explicit target',
    async (action) => {
      const { provider, runtime } = useBundledPi()
      const fixture = managerFixture({ nodeVersion: 'v24.22.1', piReady: true })
      await expect(fixture.manager[action]()).resolves.toMatchObject({
        currentVersion: runtime.version,
        ok: true
      })
      expect(provider.update).toHaveBeenCalledWith(
        'pi',
        expect.any(AbortSignal),
        expect.any(Function),
        { bundled: true }
      )
      expect(fixture.piInstaller.maintainTerminal).not.toHaveBeenCalled()
    }
  )

  it('reports terminal verification failure without updating bundled Pi', async () => {
    const { provider } = useBundledPi()
    const fixture = managerFixture({ nodeVersion: 'v24.22.1', piReady: true })
    fixture.piInstaller.maintainTerminal.mockRejectedValue(
      new Error('Terminal still resolves Pi 0.8.0')
    )

    await expect(fixture.manager.updatePi(false, 'terminal')).rejects.toThrow(
      'Terminal still resolves Pi 0.8.0'
    )
    expect(provider.update).not.toHaveBeenCalled()
    expect(fixture.manager.getTask()).toMatchObject({ state: 'failed', result: null })
  })

  it('fails safely if the chosen terminal Pi disappears', async () => {
    const { provider } = useBundledPi()
    const fixture = managerFixture({ nodeVersion: 'v24.22.1', piReady: true })
    fixture.piInstaller.maintainTerminal.mockResolvedValue(null)

    await expect(fixture.manager.reinstallPi('terminal')).rejects.toMatchObject({
      code: 'PI_NOT_FOUND_AFTER_INSTALL'
    })
    expect(provider.update).not.toHaveBeenCalled()
  })

  it('discovers terminal Pi independently of the bundled runtime', async () => {
    const { provider, runtime } = useBundledPi()
    const fixture = managerFixture({ nodeVersion: 'v24.22.1', piReady: true })
    const terminal = { cliPath: '/terminal/pi', version: '0.8.0' }
    fixture.piInstaller.getTerminalInstallation.mockResolvedValue(terminal)

    await expect(fixture.manager.getTerminalPi()).resolves.toEqual(terminal)
    expect(fixture.piInstaller.getTerminalInstallation).toHaveBeenCalledWith(runtime.executablePath)
    expect(provider.update).not.toHaveBeenCalled()
  })

  it('installs Node before Pi when Node is missing', async () => {
    const fixture = managerFixture({ nodeVersion: null, piReady: false })

    const result = await fixture.manager.bootstrap()

    expect(result).toEqual(installResult)
    expect(fixture.order).toEqual(
      expect.arrayContaining(['detect-runtime', 'install-node', 'install-pi'])
    )
    expect(fixture.order.indexOf('install-node')).toBeLessThan(fixture.order.indexOf('install-pi'))
    expect(fixture.tasks.at(-1)).toMatchObject({ state: 'success', progress: 100 })
  })

  it('upgrades Node versions below the Pi SDK minimum before installing Pi', async () => {
    const fixture = managerFixture({ nodeVersion: 'v22.18.0', piReady: false })

    await fixture.manager.bootstrap()

    expect(fixture.nodeInstaller.install).toHaveBeenCalledOnce()
    expect(fixture.piInstaller.install).toHaveBeenCalledOnce()
  })

  it.each(['v22.23.4', 'v24.22.1', 'v26.12.1'])(
    'reuses supported Node %s without downgrading',
    async (version) => {
      const fixture = managerFixture({ nodeVersion: version, piReady: false })

      await fixture.manager.bootstrap()

      expect(fixture.nodeInstaller.install).not.toHaveBeenCalled()
      expect(fixture.piInstaller.install).toHaveBeenCalledOnce()
    }
  )

  it('does not reinstall an already healthy Pi', async () => {
    const fixture = managerFixture({ nodeVersion: 'v24.22.1', piReady: true })

    const result = await fixture.manager.bootstrap()

    expect(fixture.piInstaller.install).not.toHaveBeenCalled()
    expect(result.message).toContain('already installed')
  })

  it('uses a single task when install is clicked repeatedly', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fixture = managerFixture({ nodeVersion: 'v24.22.1', piReady: false })
    fixture.piInstaller.install.mockImplementation(async (options) => {
      await gate
      fixture.setPiReady(true)
      options?.onProgress?.({ phase: 'pi-ready', progress: 100, message: 'ready' })
      return installResult
    })

    const first = fixture.manager.bootstrap()
    const second = fixture.manager.bootstrap()
    await vi.waitFor(() => expect(fixture.piInstaller.install).toHaveBeenCalledOnce())
    release()

    await expect(Promise.all([first, second])).resolves.toEqual([installResult, installResult])
    expect(fixture.piInstaller.install).toHaveBeenCalledOnce()
  })

  it('stops before Pi and releases the task lock when Node installation fails', async () => {
    const fixture = managerFixture({ nodeVersion: null, piReady: false })
    fixture.nodeInstaller.install.mockRejectedValueOnce(new Error('download failed'))

    await expect(fixture.manager.bootstrap()).rejects.toThrow('download failed')
    expect(fixture.piInstaller.install).not.toHaveBeenCalled()
    expect(fixture.manager.getTask()).toMatchObject({ state: 'failed', cancellable: false })

    await expect(fixture.manager.bootstrap()).resolves.toEqual(installResult)
    expect(fixture.piInstaller.install).toHaveBeenCalledOnce()
  })

  it('exposes Pi installation failure and permits a clean retry', async () => {
    const fixture = managerFixture({ nodeVersion: 'v24.22.1', piReady: false })
    fixture.piInstaller.install.mockRejectedValueOnce(new Error('npm exited with code 1'))

    await expect(fixture.manager.bootstrap()).rejects.toThrow('npm exited with code 1')
    expect(fixture.manager.getTask()).toMatchObject({
      state: 'failed',
      message: 'npm exited with code 1',
      cancellable: false
    })

    await expect(fixture.manager.bootstrap()).resolves.toEqual(installResult)
    expect(fixture.piInstaller.install).toHaveBeenCalledTimes(2)
  })

  it('repairs Node.js/npm and retries when npm disappears during installation', async () => {
    const fixture = managerFixture({ nodeVersion: 'v24.22.1', piReady: false })
    fixture.piInstaller.install.mockRejectedValueOnce(
      new EnvironmentError('NPM_NOT_FOUND', 'spawn npm ENOENT')
    )

    await expect(fixture.manager.bootstrap()).resolves.toEqual(installResult)
    expect(fixture.nodeInstaller.install).toHaveBeenCalledOnce()
    expect(fixture.piInstaller.install).toHaveBeenCalledTimes(2)
  })

  it('cancels a running install and leaves an observable cancelled task', async () => {
    const fixture = managerFixture({ nodeVersion: 'v24.22.1', piReady: false })
    fixture.piInstaller.install.mockImplementation(
      (options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true
          })
        })
    )

    const installing = fixture.manager.bootstrap()
    await vi.waitFor(() => expect(fixture.piInstaller.install).toHaveBeenCalledOnce())
    await fixture.manager.cancel()

    await expect(installing).rejects.toThrow('cancelled')
    expect(fixture.manager.getTask()).toMatchObject({
      state: 'cancelled',
      cancellable: false,
      error: { code: 'INSTALL_CANCELLED' }
    })
  })

  it('streams Pi update progress and command output into the environment task', async () => {
    const fixture = managerFixture({ nodeVersion: 'v24.22.1', piReady: true })
    fixture.piInstaller.update.mockImplementation(async (_force, options) => {
      options?.onProgress?.({ phase: 'running-pi-update', progress: 25, message: 'Updating Pi' })
      options?.onLog?.('Downloading Pi update', 'stdout')
      return updateResult
    })

    await expect(fixture.manager.updatePi()).resolves.toEqual(updateResult)

    expect(fixture.piInstaller.update).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(fixture.manager.getTask()).toMatchObject({
      state: 'success',
      progress: 100,
      logs: expect.arrayContaining([
        expect.objectContaining({ level: 'stdout', message: 'Downloading Pi update' })
      ])
    })
  })
})

function useBundledPi() {
  const runtime: ResolvedRuntime = {
    source: 'bundled',
    executablePath: '/bundled/pi',
    version: catalog.pi.version,
    platform: process.platform,
    arch: process.arch,
    valid: true,
    integrity: 'verified',
    diagnosticMessages: []
  }
  const provider = {
    resolve: vi.fn().mockResolvedValue(runtime),
    update: vi.fn().mockResolvedValue({ pi: runtime }),
    diagnostics: vi.fn().mockResolvedValue({ activeSessions: 0 }),
    invalidate: vi.fn()
  }
  setRuntimeProvider(provider as unknown as RuntimeProvider)
  return { provider, runtime }
}

function managerFixture(options: { nodeVersion: string | null; piReady: boolean }) {
  let nodeVersion = options.nodeVersion
  let piReady = options.piReady
  const order: string[] = []
  const tasks: Array<ReturnType<EnvironmentManager['getTask']>> = []
  const nodeInstaller = {
    install: vi.fn(async (installOptions) => {
      order.push('install-node')
      installOptions?.onProgress?.({
        phase: 'node-ready',
        progress: 100,
        message: 'Node ready'
      })
      nodeVersion = 'v24.22.1'
      return {
        skipped: false,
        version: '24.22.1',
        root: '/tmp/node',
        nodePath: '/tmp/node/bin/node',
        npmPath: '/tmp/node/bin/npm'
      }
    })
  }
  const piInstaller = {
    install: vi.fn(async (installOptions) => {
      order.push('install-pi')
      installOptions?.onProgress?.({ phase: 'pi-ready', progress: 100, message: 'Pi ready' })
      installOptions?.onLog?.('npm install completed', 'stdout')
      piReady = true
      return installResult
    }),
    getTerminalInstallation: vi.fn(),
    maintainTerminal: vi.fn(),
    update: vi.fn(),
    checkLatest: vi.fn()
  }
  const detectRuntime = vi.fn(async () => {
    order.push('detect-runtime')
    const installed = nodeVersion !== null
    const supported = installed && isNodeVersionSupported(nodeVersion)
    return {
      nodeInstalled: installed,
      nodeSupported: supported,
      nodeVersion,
      nodePath: installed ? '/tmp/bin/node' : null,
      npmInstalled: supported,
      npmPath: supported ? '/tmp/bin/npm' : null,
      npmVersion: supported ? '11.0.0' : null,
      ready: supported
    } as never
  })
  const detectEnvironment = vi.fn(
    async () =>
      ({
        installed: piReady,
        version: piReady ? '0.84.2' : null,
        state: piReady ? 'ready' : 'pi-required',
        piStatus: piReady ? 'ready' : 'missing',
        nodeRuntime: await detectRuntime()
      }) as unknown as PiEnvironment
  )
  const settingsStore = {
    peek: () => ({ manualCliPath: null, manualConfigDir: null }) as AppSettings
  } as JsonStore<AppSettings>
  const manager = new EnvironmentManager(settingsStore, {
    nodeInstaller: nodeInstaller as never,
    piInstaller: piInstaller as never,
    detectRuntime,
    detectEnvironment: async () => detectEnvironment(),
    refreshPath: async () => '/tmp/bin',
    uuid: () => 'task-1',
    now: (() => {
      let now = 1
      return () => now++
    })(),
    onTask: (task) => tasks.push(task),
    onEnvironmentChanged: vi.fn()
  })
  return {
    manager,
    nodeInstaller,
    piInstaller,
    order,
    tasks,
    setPiReady: (value: boolean) => {
      piReady = value
    }
  }
}
