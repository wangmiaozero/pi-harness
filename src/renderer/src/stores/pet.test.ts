import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  PET_JUMP_DURATION_MS,
  PET_SUCCESS_DURATION_MS,
  PET_WAVE_DURATION_MS,
  usePetStore
} from './pet'

describe('pet store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    setActivePinia(createPinia())
  })

  afterEach(() => {
    usePetStore().dispose()
    vi.useRealTimers()
  })

  it('runs success -> jumping -> review and re-resolves the durable state', () => {
    const pet = usePetStore()
    pet.handleEvent({ type: 'TASK_STARTED' })
    pet.handleEvent({ type: 'TASK_SUCCEEDED' })

    expect(pet.state).toBe('success')
    vi.advanceTimersByTime(PET_SUCCESS_DURATION_MS)
    expect(pet.state).toBe('jumping')
    vi.advanceTimersByTime(PET_JUMP_DURATION_MS)
    expect(pet.state).toBe('review')
    expect(pet.temporaryState).toBeNull()
  })

  it('returns to the current runtime state after a temporary animation', () => {
    const pet = usePetStore()
    pet.handleEvent({ type: 'THINKING_STARTED' })
    pet.setTemporaryState('waving', PET_WAVE_DURATION_MS)
    expect(pet.state).toBe('waving')

    vi.advanceTimersByTime(PET_WAVE_DURATION_MS)
    expect(pet.state).toBe('thinking')
  })

  it('waves for a new session without losing an already-running task', () => {
    const pet = usePetStore()
    pet.handleEvent({ type: 'TASK_STARTED' })
    pet.handleEvent({ type: 'SESSION_CREATED' })
    expect(pet.state).toBe('waving')

    vi.advanceTimersByTime(PET_WAVE_DURATION_MS)
    expect(pet.state).toBe('running')
  })

  it('sleeps only while idle and waves when user activity wakes it', () => {
    const pet = usePetStore()
    pet.configureSleep(true, 10_000)
    vi.advanceTimersByTime(10_000)
    expect(pet.state).toBe('sleeping')

    pet.handleEvent({ type: 'USER_ACTIVITY' })
    expect(pet.state).toBe('waving')
    vi.advanceTimersByTime(PET_WAVE_DURATION_MS)
    expect(pet.state).toBe('idle')
  })

  it('keeps long-running work awake regardless of inactivity', () => {
    const pet = usePetStore()
    pet.configureSleep(true, 1000)
    pet.handleEvent({ type: 'TASK_STARTED' })
    vi.advanceTimersByTime(60_000)
    expect(pet.state).toBe('running')
  })

  it('tracks concurrent tools and prioritizes code mutation tools', () => {
    const pet = usePetStore()
    pet.handleEvent({ type: 'TASK_STARTED' })
    pet.handleEvent({ type: 'TOOL_CALL_STARTED', id: 'read', tool: 'read_file' })
    expect(pet.state).toBe('tool-calling')

    pet.handleEvent({ type: 'TOOL_CALL_STARTED', id: 'edit', tool: 'apply_patch' })
    expect(pet.state).toBe('coding')
    expect(pet.currentTool).toBe('apply_patch')

    pet.handleEvent({ type: 'TOOL_CALL_FINISHED', id: 'edit' })
    expect(pet.state).toBe('tool-calling')
    pet.handleEvent({ type: 'TOOL_CALL_FINISHED', id: 'read' })
    expect(pet.state).toBe('running')
  })

  it('returns directly from coding to running when its only tool finishes', () => {
    const pet = usePetStore()
    pet.handleEvent({ type: 'TASK_STARTED' })
    pet.handleEvent({ type: 'TOOL_CALL_STARTED', id: 'edit', tool: 'edit_file' })
    expect(pet.state).toBe('coding')
    pet.handleEvent({ type: 'TOOL_CALL_FINISHED', id: 'edit' })
    expect(pet.state).toBe('running')
  })

  it('clears stale tool state when the runtime settles', () => {
    const pet = usePetStore()
    pet.handleEvent({ type: 'TASK_STARTED' })
    pet.handleEvent({ type: 'TOOL_CALL_STARTED', id: 'shell', tool: 'exec_command' })
    expect(pet.state).toBe('tool-calling')
    pet.handleEvent({ type: 'RUNTIME_SETTLED' })
    expect(pet.state).toBe('idle')
    expect(pet.currentTool).toBeNull()
  })

  it('follows thinking, running, waiting, warning, and recovery transitions', () => {
    const pet = usePetStore()
    pet.handleEvent({ type: 'THINKING_STARTED' })
    expect(pet.state).toBe('thinking')
    pet.handleEvent({ type: 'THINKING_FINISHED' })
    expect(pet.state).toBe('running')

    pet.handleEvent({ type: 'WAITING_FOR_USER', waiting: true })
    expect(pet.state).toBe('waiting')
    pet.handleEvent({ type: 'WAITING_FOR_USER', waiting: false })
    pet.handleEvent({ type: 'THINKING_STARTED' })
    expect(pet.state).toBe('thinking')

    pet.handleEvent({ type: 'THINKING_FINISHED' })
    pet.handleEvent({ type: 'WARNING', durationMs: 1000 })
    expect(pet.state).toBe('warning')
    vi.advanceTimersByTime(1000)
    expect(pet.state).toBe('running')
  })

  it('keeps failure durable until the next task starts', () => {
    const pet = usePetStore()
    pet.handleEvent({ type: 'TASK_STARTED' })
    expect(pet.state).toBe('running')
    pet.handleEvent({ type: 'TASK_FAILED' })
    expect(pet.state).toBe('failed')
    pet.handleEvent({ type: 'USER_ACTIVITY' })
    expect(pet.state).toBe('failed')

    pet.handleEvent({ type: 'TASK_STARTED' })
    expect(pet.state).toBe('running')
  })
})
