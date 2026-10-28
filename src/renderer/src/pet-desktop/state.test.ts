import { afterEach, describe, expect, it, vi } from 'vitest'
import { PetStateReducer } from './state'
afterEach(() => vi.useRealTimers())
describe('desktop runtime aggregation', () => {
  it('retains work while another task finishes', () => {
    const state = new PetStateReducer()
    expect(state.apply([{ type: 'TASK_STARTED' }], 2)?.state).toBe('running')
    state.apply([{ type: 'TASK_SUCCEEDED' }], 1)
    expect(state.apply([], 1)?.state ?? 'running').toBe('running')
    expect(state.apply([{ type: 'TASK_SUCCEEDED' }], 0)?.state).toBe('success')
  })
  it('defers completion feedback until the runtime reports that the last task has settled', () => {
    const state = new PetStateReducer()
    state.apply([{ type: 'TASK_STARTED' }], 1)
    state.apply([{ type: 'TASK_SUCCEEDED' }], 1)
    expect(state.apply([], 0)?.state).toBe('success')
  })

  it('does not fall asleep during long tasks', () => {
    vi.useFakeTimers()
    const state = new PetStateReducer()
    state.apply([{ type: 'THINKING_STARTED' }], 1)
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(state.apply([], 1)?.state ?? state.apply([{ type: 'THINKING_STARTED' }], 1)?.state).toBe(
      'thinking'
    )
  })
})
