import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import { isErrorPayload } from '@shared/types/errors'
import { rememberNativeDropPaths, resetNativeDropPaths } from './dropped-path'

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
    resetNativeDropPaths()
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
    const error = await (bridge.agentAura as unknown as { setActive(): Promise<never> })
      .setActive()
      .catch((e: unknown) => e)
    expect(isErrorPayload(error)).toBe(true)
    expect((error as { code: string }).code).toBe('SHELL_METHOD_PENDING')
    expect((error as { context: { namespace: string } }).context.namespace).toBe('agentAura')
  })

  it('pending namespaces reject every method on the same namespace', async () => {
    const bridge = createTauriBridge()
    const errors = await Promise.all(
      [
        (bridge.agentAura as unknown as { setActive(): Promise<never> }).setActive(),
        (bridge.agentAura as unknown as { setActive(): Promise<never> }).setActive()
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
    const bridge = createTauriBridge()
    const error: unknown = await (bridge.agentAura as unknown as { setActive(): Promise<never> })
      .setActive()
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'SHELL_METHOD_PENDING' })
    expect((error as { message: string }).message).toContain('agentAura.setActive')
  })

  it('settings and providers go through runtime_request', async () => {
    invokeMock.mockResolvedValue({ language: 'auto' })
    const bridge = createTauriBridge()
    await bridge.settings.get()
    await bridge.providers.list()
    expect(invokeMock).toHaveBeenCalledWith('runtime_request', {
      method: 'settings.get',
      params: {}
    })
    expect(invokeMock).toHaveBeenCalledWith('runtime_request', {
      method: 'providers.list',
      params: {}
    })
  })

  it('host-owned pi/backup/diagnostics commands invoke Rust', async () => {
    invokeMock.mockResolvedValue(undefined)
    const bridge = createTauriBridge()
    await bridge.pi.openNodeDownload()
    await bridge.backup.openFolder()
    await bridge.logs.openFolder()
    expect(invokeMock).toHaveBeenCalledWith('pi_open_node_download')
    expect(invokeMock).toHaveBeenCalledWith('backup_open_folder')
    expect(invokeMock).toHaveBeenCalledWith('logs_open_folder')
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

  it('workspace/files/git/worktrees invoke Rust commands', async () => {
    invokeMock.mockResolvedValue(undefined)
    const bridge = createTauriBridge()
    await bridge.workspace.pickDirectory()
    await bridge.files.list('/repo')
    await bridge.git.status('/repo')
    await bridge.worktrees.list('/repo')
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'workspace_pick_directory')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'files_list', { directory: '/repo' })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'git_status', { cwd: '/repo' })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'worktrees_list', { cwd: '/repo' })
  })

  it('agent.start asserts cwd before runtime_request', async () => {
    invokeMock.mockResolvedValueOnce('/repo').mockResolvedValueOnce({ sessionId: 's1', cwd: '/repo' })
    const bridge = createTauriBridge()
    await bridge.agent.start({ cwd: '/repo', message: 'hi' })
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'workspace_assert_cwd', { cwd: '/repo' })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'runtime_request', {
      method: 'agent.start',
      params: { cwd: '/repo', message: 'hi' }
    })
  })

  it('workspace.listProjects groups session.list over runtime_request', async () => {
    invokeMock.mockResolvedValueOnce({
      sessions: [
        {
          path: '/tmp/a.jsonl',
          id: 'a',
          cwd: '/tmp/proj',
          created: '2026-01-01',
          modified: '2026-01-02',
          messageCount: 1,
          firstMessage: 'hi'
        }
      ]
    })
    const bridge = createTauriBridge()
    const groups = await bridge.workspace.listProjects()
    expect(invokeMock).toHaveBeenCalledWith('runtime_request', {
      method: 'session.list',
      params: { force: false }
    })
    expect(groups.length).toBeGreaterThan(0)
    expect(groups[0]?.projectRoot).toBe('/tmp/proj')
  })

  it('workspace.getPathForFile sends a resolved string path', async () => {
    invokeMock.mockResolvedValueOnce('/tmp/proj')
    const bridge = createTauriBridge()
    await bridge.workspace.getPathForFile({ path: '/tmp/proj', name: 'proj' })
    expect(invokeMock).toHaveBeenCalledWith('workspace_get_path_for_file', { file: '/tmp/proj' })
  })

  it('workspace.getPathForFile matches native drop cache by File.name', async () => {
    rememberNativeDropPaths(['/Users/me/code/pi-harness'])
    invokeMock.mockResolvedValueOnce('/Users/me/code/pi-harness')
    const bridge = createTauriBridge()
    await bridge.workspace.getPathForFile({ name: 'pi-harness' })
    expect(invokeMock).toHaveBeenCalledWith('workspace_get_path_for_file', {
      file: '/Users/me/code/pi-harness'
    })
  })

  it('workspace.getPathForFile rejects when WKWebView File has no path', async () => {
    const bridge = createTauriBridge()
    const error = await bridge.workspace.getPathForFile({ name: 'proj' }).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('updater and session export invoke Rust commands', async () => {
    invokeMock.mockResolvedValue(undefined)
    const bridge = createTauriBridge()
    await bridge.updater.check()
    await bridge.sessions.export('s1', 'markdown')
    expect(invokeMock).toHaveBeenCalledWith('updater_check')
    expect(invokeMock).toHaveBeenCalledWith('sessions_export', {
      sessionId: 's1',
      format: 'markdown'
    })
  })
})
