import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { EnvironmentInstallTask, PiEnvironment, PiSwitchAPI } from '@shared/ipc/api-types'
import { usePiStore } from './pi'

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
})

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
