import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import { isErrorPayload } from '@shared/types/errors'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {})
}))

import { createTauriBridge } from './tauri'

describe('tauri bridge', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('system.info invokes system_info', async () => {
    invokeMock.mockResolvedValueOnce({
      platform: 'darwin',
      arch: 'arm64',
      versions: { electron: '', chrome: '', node: 'v26.7.0' },
      appVersion: '1.6.0',
      packaged: false
    })
    const bridge = createTauriBridge()
    const info = await bridge.system.info()
    expect(invokeMock).toHaveBeenCalledWith('system_info')
    expect(info.platform).toBe('darwin')
    expect(info.versions.node).toBe('v26.7.0')
  })

  it('system.openPath forwards the path argument', async () => {
    invokeMock.mockResolvedValueOnce(undefined)
    const bridge = createTauriBridge()
    await bridge.system.openPath('/tmp')
    expect(invokeMock).toHaveBeenCalledWith('system_open_path', { path: '/tmp' })
  })

  it('window controls map to the Rust commands', async () => {
    invokeMock.mockResolvedValue(undefined)
    const bridge = createTauriBridge()
    await bridge.window.minimize()
    await bridge.window.maximizeToggle()
    await bridge.window.close()
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'window_minimize')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'window_maximize_toggle')
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'window_close')
  })

  it('pending namespaces reject with SHELL_METHOD_PENDING payloads', async () => {
    const bridge = createTauriBridge()
    const error = await bridge.git.status('/repo').catch((e: unknown) => e)
    expect(isErrorPayload(error)).toBe(true)
    expect((error as { code: string }).code).toBe('SHELL_METHOD_PENDING')
    expect((error as { context: { namespace: string } }).context.namespace).toBe('git')
  })

  it('pending namespaces reject every method on the same namespace', async () => {
    const bridge = createTauriBridge()
    const errors = await Promise.all(
      [
        (bridge.settings as unknown as { get(): Promise<never> }).get(),
        (bridge.settings as unknown as { set(p: unknown): Promise<never> }).set({})
      ].map((p) => p.catch((e: unknown) => e))
    )
    for (const error of errors) {
      expect((error as { code: string }).code).toBe('SHELL_METHOD_PENDING')
    }
  })

  it('runtime namespace invokes the runtime commands', async () => {
    invokeMock.mockResolvedValue({ phase: 'stopped' })
    const bridge = createTauriBridge()
    await bridge.runtime.start()
    expect(invokeMock).toHaveBeenCalledWith('runtime_start')
    await bridge.runtime.stop()
    expect(invokeMock).toHaveBeenCalledWith('runtime_stop')
    await bridge.runtime.restart()
    expect(invokeMock).toHaveBeenCalledWith('runtime_restart')
  })

  it('runtime.ping returns the host-shaped result', async () => {
    invokeMock.mockResolvedValueOnce({ pong: true, timestamp: 1234 })
    const bridge = createTauriBridge()
    const result = await bridge.runtime.ping()
    expect(result).toEqual({ pong: true, timestamp: 1234 })
    expect(invokeMock).toHaveBeenCalledWith('runtime_ping')
  })

  it('runtime.version returns the identity triple', async () => {
    invokeMock.mockResolvedValueOnce({
      runtimeVersion: '0.1.0',
      protocolVersion: 1,
      nodeVersion: 'v26.7.0'
    })
    const bridge = createTauriBridge()
    const version = await bridge.runtime.version()
    expect(version.runtimeVersion).toBe('0.1.0')
    expect(version.protocolVersion).toBe(1)
  })

  it('pending methods surface as structured errors for renderer pipelines', async () => {
    // The renderer's getErrorPayload accepts plain payload objects; assert
    // the rejection reason is exactly such a shape.
    const bridge = createTauriBridge()
    const error: unknown = await (bridge.pi as unknown as { detect(): Promise<never> })
      .detect()
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'SHELL_METHOD_PENDING' })
    expect((error as { message: string }).message).toContain('pi.detect')
  })

  it('harness control-plane methods go through runtime_request', async () => {
    invokeMock.mockResolvedValue([])
    const bridge = createTauriBridge()
    await bridge.harness.listRuns('sess-1', 'session')
    expect(invokeMock).toHaveBeenCalledWith('runtime_request', {
      method: 'harness.listRuns',
      params: { sessionId: 'sess-1', scope: 'session' }
    })
  })

  it('orchestration methods go through runtime_request', async () => {
    invokeMock.mockResolvedValue({ id: 'orch-1' })
    const bridge = createTauriBridge()
    await bridge.orchestration.create({ cwd: '/tmp/proj', strategy: 'dependency' })
    expect(invokeMock).toHaveBeenCalledWith('runtime_request', {
      method: 'orchestration.create',
      params: { cwd: '/tmp/proj', strategy: 'dependency' }
    })
  })

  it('implements the full piSwitch surface', () => {
    const bridge = createTauriBridge()
    const required: Array<keyof PiSwitchAPI> = [
      'system',
      'pi',
      'providers',
      'models',
      'config',
      'skills',
      'capabilities',
      'backup',
      'settings',
      'diagnostics',
      'logs',
      'updater',
      'window',
      'workspace',
      'sessions',
      'agent',
      'harness',
      'orchestration',
      'files',
      'git',
      'worktrees',
      'agentAura',
      'on'
    ]
    for (const key of required) {
      expect(bridge, `missing namespace: ${key}`).toHaveProperty(key)
    }
    expect(bridge).toHaveProperty('runtime')
  })
})
