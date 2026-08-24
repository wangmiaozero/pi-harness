import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, PiEnvironment, PiInstallResult } from '@shared/ipc/api-types'
import type { JsonStore } from '../services/storage'
import { EnvironmentError } from '../services/errors'

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

  it('forces a Node 20 upgrade before installing Pi', async () => {
    const fixture = managerFixture({ nodeVersion: 'v20.19.0', piReady: false })

    await fixture.manager.bootstrap()

    expect(fixture.nodeInstaller.install).toHaveBeenCalledOnce()
    expect(fixture.piInstaller.install).toHaveBeenCalledOnce()
  })

  it.each(['v22.0.0', 'v24.15.0', 'v26.7.0'])(
    'reuses supported Node %s without downgrading',
    async (version) => {
      const fixture = managerFixture({ nodeVersion: version, piReady: false })

      await fixture.manager.bootstrap()

      expect(fixture.nodeInstaller.install).not.toHaveBeenCalled()
      expect(fixture.piInstaller.install).toHaveBeenCalledOnce()
    }
  )

  it('does not reinstall an already healthy Pi', async () => {
    const fixture = managerFixture({ nodeVersion: 'v24.15.0', piReady: true })

    const result = await fixture.manager.bootstrap()

    expect(fixture.piInstaller.install).not.toHaveBeenCalled()
    expect(result.message).toContain('already installed')
  })

  it('uses a single task when install is clicked repeatedly', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fixture = managerFixture({ nodeVersion: 'v24.15.0', piReady: false })
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
    const fixture = managerFixture({ nodeVersion: 'v24.15.0', piReady: false })
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
    const fixture = managerFixture({ nodeVersion: 'v24.15.0', piReady: false })
    fixture.piInstaller.install.mockRejectedValueOnce(
      new EnvironmentError('NPM_NOT_FOUND', 'spawn npm ENOENT')
    )

    await expect(fixture.manager.bootstrap()).resolves.toEqual(installResult)
    expect(fixture.nodeInstaller.install).toHaveBeenCalledOnce()
    expect(fixture.piInstaller.install).toHaveBeenCalledTimes(2)
  })

  it('cancels a running install and leaves an observable cancelled task', async () => {
    const fixture = managerFixture({ nodeVersion: 'v24.15.0', piReady: false })
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
    const fixture = managerFixture({ nodeVersion: 'v24.15.0', piReady: true })
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
      nodeVersion = 'v24.15.0'
      return {
        skipped: false,
        version: '24.15.0',
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
    update: vi.fn(),
    checkLatest: vi.fn()
  }
  const detectRuntime = vi.fn(async () => {
    order.push('detect-runtime')
    const installed = nodeVersion !== null
    const supported = installed && Number(nodeVersion!.match(/\d+/)?.[0]) >= 22
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
