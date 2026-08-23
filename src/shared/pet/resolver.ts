import type { PetState, PetStateContext } from './types'

export const PET_SLEEP_TIMEOUT_MS = 10 * 60 * 1000

export function createPetStateContext(now = Date.now()): PetStateContext {
  return {
    hasError: false,
    hasWarning: false,
    waitingForUser: false,
    thinking: false,
    running: false,
    streaming: false,
    toolCalling: false,
    coding: false,
    taskCompleted: false,
    taskSucceeded: false,
    activeSession: false,
    lastActivityAt: now,
    now,
    sleepEnabled: true,
    sleepTimeoutMs: PET_SLEEP_TIMEOUT_MS
  }
}

/** Resolve only durable runtime state. Temporary animation states are applied by the Pet Store. */
export function resolvePetState(context: PetStateContext): PetState {
  if (context.hasError) return 'failed'
  if (context.waitingForUser) return 'waiting'
  if (context.hasWarning) return 'warning'
  if (context.toolCalling) return 'tool-calling'
  if (context.coding) return 'coding'
  if (context.thinking) return 'thinking'
  if (context.running || context.streaming) return 'running'
  if (context.taskCompleted && context.taskSucceeded) return 'review'
  if (context.sleepEnabled && context.now - context.lastActivityAt >= context.sleepTimeoutMs) {
    return 'sleeping'
  }
  return 'idle'
}
