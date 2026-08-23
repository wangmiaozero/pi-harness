import { describe, expect, it } from 'vitest'
import { createPetStateContext, PET_SLEEP_TIMEOUT_MS, resolvePetState } from './resolver'
import type { PetStateContext } from './types'

function state(patch: Partial<PetStateContext>) {
  return resolvePetState({ ...createPetStateContext(1_000), ...patch })
}

describe('resolvePetState', () => {
  it('resolves every durable runtime state', () => {
    expect(state({})).toBe('idle')
    expect(state({ thinking: true })).toBe('thinking')
    expect(state({ running: true })).toBe('running')
    expect(state({ coding: true })).toBe('coding')
    expect(state({ toolCalling: true })).toBe('tool-calling')
    expect(state({ waitingForUser: true })).toBe('waiting')
    expect(state({ taskCompleted: true, taskSucceeded: true })).toBe('review')
    expect(state({ hasError: true })).toBe('failed')
    expect(state({ hasWarning: true })).toBe('warning')
  })

  it('applies deterministic priority', () => {
    const busy = {
      running: true,
      streaming: true,
      thinking: true,
      coding: true,
      toolCalling: true,
      hasWarning: true,
      waitingForUser: true
    }
    expect(state(busy)).toBe('waiting')
    expect(state({ ...busy, hasError: true })).toBe('failed')
    expect(state({ running: true, coding: true, toolCalling: true })).toBe('tool-calling')
  })

  it('sleeps only after an idle timeout and never during a long task', () => {
    const now = PET_SLEEP_TIMEOUT_MS + 1
    expect(state({ now, lastActivityAt: 0 })).toBe('sleeping')
    expect(state({ now, lastActivityAt: 0, running: true })).toBe('running')
    expect(state({ now, lastActivityAt: 0, coding: true })).toBe('coding')
    expect(state({ now, lastActivityAt: 0, sleepEnabled: false })).toBe('idle')
  })
})
