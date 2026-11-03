import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import type { HarnessState, HarnessSessionInfo } from '@shared/types/harness'
import { useHarnessStore } from './harness'

function liveState(sessionId: string): HarnessState {
  return {
    sessionId,
    runtime: {
      status: 'running',
      isStreaming: false,
      isPromptRunning: false,
      isBashRunning: false,
      isCompacting: false
    },
    thinking: { level: 'off', options: [] },
    context: null,
    compaction: { auto: true, running: false },
    queue: { pendingMessages: 0, steering: [], followUp: [] },
    tools: [],
    capabilities: {
      prompt: true,
      abort: true,
      steering: true,
      followUp: true,
      compaction: true,
      abortCompaction: true,
      autoCompaction: true,
      autoRetry: true,
      thinkingLevel: true,
      tools: true,
      skills: true,
      extensions: true,
      sessionFork: true,
      sessionTree: true,
      modelSwitch: true,
      contextUsage: true,
      stats: true
    }
  }
}

describe('Harness historical session reads', () => {
  const state = vi.fn()
  const session = vi.fn()
  const timeline = vi.fn()
  const start = vi.fn()

  beforeEach(() => {
    setActivePinia(createPinia())
    state.mockReset().mockResolvedValue(null)
    session.mockReset().mockRejectedValue({ code: 'SESSION_NOT_RUNNING', message: 'Not running' })
    timeline.mockReset().mockResolvedValue([])
    start.mockReset()
    window.piSwitch = {
      agent: { start },
      harness: {
        state,
        session,
        timeline,
        listRuns: vi.fn().mockResolvedValue([]),
        listEvaluations: vi.fn().mockResolvedValue([]),
        getRunTree: vi.fn().mockResolvedValue([]),
        listCheckpoints: vi.fn().mockResolvedValue([]),
        listArtifacts: vi.fn().mockResolvedValue([]),
        getPolicy: vi.fn().mockResolvedValue(null),
        getBaseline: vi.fn().mockResolvedValue(null),
        getProjectStats: vi.fn().mockResolvedValue(null),
        getStoreSettings: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PiSwitchAPI
  })

  afterEach(() => {
    delete window.piSwitch
  })

  it('browses inactive history without requesting a live session or starting Pi', async () => {
    const store = useHarnessStore()
    await store.load('history')
    await store.refresh()
    expect(store.sessionId).toBe('history')
    expect(store.state).toBeNull()
    expect(store.session).toBeNull()
    expect(store.error).toBeNull()
    expect(timeline).toHaveBeenCalledWith('history')
    expect(session).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('keeps live information and clears it after the runtime stops', async () => {
    const info: HarnessSessionInfo = {
      sessionId: 'live',
      persisted: true,
      leafId: 'entry',
      entries: []
    }
    state.mockResolvedValue(liveState('live'))
    session.mockResolvedValue(info)
    const store = useHarnessStore()
    await store.load('live')
    expect(store.session).toEqual(info)
    state.mockResolvedValue(null)
    await store.refresh()
    expect(store.state).toBeNull()
    expect(store.session).toBeNull()
    expect(store.error).toBeNull()
    expect(session).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
  })

  it('does not fetch or display a late live response after switching sessions', async () => {
    let resolve!: (state: HarnessState) => void
    state.mockReturnValueOnce(
      new Promise<HarnessState>((done) => {
        resolve = done
      })
    )
    const store = useHarnessStore()
    const oldLoad = store.load('old')
    await store.load('history')
    resolve(liveState('old'))
    await oldLoad
    expect(store.sessionId).toBe('history')
    expect(store.state).toBeNull()
    expect(store.loading).toBe(false)
    expect(session).not.toHaveBeenCalled()
  })
  it('cancels queued event refreshes when listeners stop or the selected session changes', async () => {
    vi.useFakeTimers()
    try {
      let receive!: (payload: unknown) => void
      const unsubscribe = vi.fn()
      window.piSwitch!.on = vi.fn((_channel, callback) => {
        receive = callback as (payload: unknown) => void
        return unsubscribe
      })
      const store = useHarnessStore()
      await store.load('old')
      const stop = store.setupListeners()
      receive({ sessionId: 'old', event: { type: 'run.started' } })
      expect(vi.getTimerCount()).toBe(2)
      await store.load(null)
      expect(vi.getTimerCount()).toBe(0)
      await store.load('new')
      receive({ sessionId: 'new', event: { type: 'run.started' } })
      stop()
      expect(vi.getTimerCount()).toBe(0)
      expect(unsubscribe).toHaveBeenCalledOnce()
      const reads = state.mock.calls.length
      await vi.runAllTimersAsync()
      expect(state).toHaveBeenCalledTimes(reads)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never puts a stale run detail or comparison into the newly selected session', async () => {
    let detail!: (value: unknown) => void
    let comparison!: (value: unknown) => void
    window.piSwitch!.harness.getRunDetail = vi.fn(
      () =>
        new Promise((resolve) => {
          detail = resolve
        })
    ) as never
    window.piSwitch!.harness.compareRuns = vi.fn(
      () =>
        new Promise((resolve) => {
          comparison = resolve
        })
    ) as never
    const store = useHarnessStore()
    await store.load('old')
    const oldDetail = store.loadRunDetail('old-run')
    const oldComparison = store.loadComparison('old-a', 'old-b')
    await store.load(null)
    await store.load('new')
    detail({ run: { id: 'old-run' } })
    comparison({ runA: { id: 'old-a' } })
    await Promise.all([oldDetail, oldComparison])
    expect(store.runDetail).toBeNull()
    expect(store.comparison).toBeNull()
    expect(store.currentRunId).toBeNull()
  })
})
