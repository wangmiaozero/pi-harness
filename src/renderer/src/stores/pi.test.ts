import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { EnvironmentInstallTask, PiEnvironment, PiSwitchAPI } from '@shared/ipc/api-types'
import { usePiStore } from './pi'
import { useSettingsStore } from './settings'
import type { AppSettings } from '@shared/ipc/api-types'

describe('Pi store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    delete window.piSwitch
  })

  afterEach(() => {
    vi.useRealTimers()
    delete window.piSwitch
  })

  it('dismisses a successful task after a short completion delay', async () => {
    const fixture = apiFixture()
    const store = usePiStore()
    const dispose = store.setupListeners()
    await Promise.resolve()

    fixture.emitTask(task({ state: 'success', progress: 100, finishedAt: Date.now() }))
    expect(store.installTask?.state).toBe('success')

    await vi.advanceTimersByTimeAsync(3_999)
    expect(store.installTask?.state).toBe('success')
    await vi.advanceTimersByTimeAsync(1)
    expect(store.installTask).toBeNull()
    dispose()
  })

  it.each(['failed', 'cancelled'] as const)(
    'keeps a %s task available for inspection',
    async (state) => {
      const fixture = apiFixture()
      const store = usePiStore()
      const dispose = store.setupListeners()
      await Promise.resolve()

      fixture.emitTask(task({ state, progress: 50, finishedAt: Date.now() }))
      await vi.advanceTimersByTimeAsync(10_000)

      expect(store.installTask?.state).toBe(state)
      dispose()
    }
  )

  it('coalesces concurrent environment detection and allows a later refresh', async () => {
    let resolveDetection: ((environment: PiEnvironment) => void) | undefined
    const detect = vi.fn(
      () =>
        new Promise<PiEnvironment>((resolve) => {
          resolveDetection = resolve
        })
    )
    window.piSwitch = { pi: { detect } } as unknown as PiSwitchAPI
    const store = usePiStore()

    const first = store.detect()
    const second = store.detect()

    expect(detect).toHaveBeenCalledTimes(1)
    expect(store.loading).toBe(true)
    resolveDetection?.({ version: '0.84.1' } as PiEnvironment)
    await Promise.all([first, second])
    expect(store.environment?.version).toBe('0.84.1')
    expect(store.loading).toBe(false)

    const refresh = store.detect()
    expect(detect).toHaveBeenCalledTimes(2)
    resolveDetection?.({ version: '0.84.2' } as PiEnvironment)
    await refresh
    expect(store.environment?.version).toBe('0.84.2')
  })

  it('reuses recent checks on navigation but keeps explicit refresh and expiry fresh', async () => {
    const api = environmentApiFixture()
    const store = usePiStore()
    await Promise.all([store.ensureFresh(), store.ensureFresh()])
    await store.ensureFresh()
    expect(api.detect).toHaveBeenCalledTimes(1)
    expect(api.checkLatest).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(29_999)
    await store.ensureFresh()
    expect(api.detect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await store.ensureFresh()
    expect(api.detect).toHaveBeenCalledTimes(2)
    await store.refresh()
    expect(api.detect).toHaveBeenCalledTimes(3)
    expect(api.checkLatest).toHaveBeenCalledTimes(3)
    api.detect.mockRejectedValueOnce(new Error('Refresh failed'))
    await store.refresh()
    await store.ensureFresh()
    expect(api.detect).toHaveBeenCalledTimes(5)
  })

  it('invalidates navigation checks when manual paths or native config change', async () => {
    const api = environmentApiFixture()
    const store = usePiStore()
    const dispose = store.setupListeners()
    await store.ensureFresh()
    useSettingsStore().settings = { manualConfigDir: '/other-config' } as AppSettings
    await store.ensureFresh()
    expect(api.detect).toHaveBeenCalledTimes(2)
    api.listeners.get('config-changed')?.({ at: Date.now() })
    await store.ensureFresh()
    expect(api.detect).toHaveBeenCalledTimes(3)
    dispose()
  })

  it('does not cache failures or overwrite an installation event with an older check', async () => {
    const api = environmentApiFixture()
    const store = usePiStore()
    api.detect.mockRejectedValueOnce(new Error('Probe failed'))
    await store.ensureFresh()
    await store.ensureFresh()
    expect(api.detect).toHaveBeenCalledTimes(2)
    expect(store.error).toBeNull()
    const dispose = store.setupListeners()
    let resolve: (value: PiEnvironment) => void = () => undefined
    api.detect.mockImplementationOnce(
      () =>
        new Promise<PiEnvironment>((complete) => {
          resolve = complete
        })
    )
    const pending = store.detect()
    api.listeners.get('pi-environment-changed')?.({ version: 'new', nodeRuntime: {} })
    resolve({ version: 'old' } as PiEnvironment)
    await pending
    expect(store.environment?.version).toBe('new')
    await store.ensureFresh()
    expect(api.detect).toHaveBeenCalledTimes(3)
    dispose()
  })
})

function environmentApiFixture() {
  const detect = vi.fn(async () => ({ version: '0.87.1', nodeRuntime: {} }) as PiEnvironment)
  const checkLatest = vi.fn(async () => ({ latestVersion: '0.87.1', updateAvailable: false }))
  const listeners = new Map<string, (payload: unknown) => void>()
  window.piSwitch = {
    pi: { detect, checkLatest, getInstallTask: vi.fn(async () => null) },
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    })
  } as unknown as PiSwitchAPI
  return { detect, checkLatest, listeners }
}

function apiFixture() {
  let taskListener: ((payload: EnvironmentInstallTask) => void) | null = null
  window.piSwitch = {
    pi: { getInstallTask: vi.fn().mockResolvedValue(null) },
    on: vi.fn((event: string, listener: (payload: EnvironmentInstallTask) => void) => {
      if (event === 'environment-install-task') taskListener = listener
      return vi.fn()
    })
  } as unknown as PiSwitchAPI
  return {
    emitTask: (value: EnvironmentInstallTask) => taskListener?.(value)
  }
}

function task(
  overrides: Partial<EnvironmentInstallTask> & Pick<EnvironmentInstallTask, 'state'>
): EnvironmentInstallTask {
  return {
    id: 'task-1',
    type: 'pi',
    phase: overrides.state,
    progress: 0,
    message: overrides.state,
    logs: [],
    startedAt: Date.now(),
    finishedAt: null,
    cancellable: false,
    error: null,
    result: null,
    ...overrides
  }
}
