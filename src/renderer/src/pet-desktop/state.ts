/**
 * Desktop pet runtime state reducer — folds pushed agent events into a
 * single logical pet state, with merge guards so high-frequency streaming
 * events never cause animation jitter.
 */

import {
  PET_EAT_TOKEN_MIN_INTERVAL_MS,
  PET_MIN_STATE_DURATION_MS
} from '@shared/pet/desktop'
import { PET_SLEEP_TIMEOUT_MS } from '@shared/pet/resolver'
import type { PetEvent } from '@shared/pet/types'

export type PetRuntimeState =
  | 'idle'
  | 'thinking'
  | 'running'
  | 'tool-calling'
  | 'waiting'
  | 'success'
  | 'failed'
  | 'warning'
  | 'sleeping'

const SUCCESS_DURATION_MS = 4000
const FAILED_DURATION_MS = 5000
const WARNING_DURATION_MS = 4000

export interface PetStateSnapshot {
  state: PetRuntimeState
}

export class PetStateReducer {
  private thinking = false
  private running = false
  private streaming = false
  private toolCalling = false
  private waiting = false
  private hasError = false
  private hasWarning = false
  private lastActivityAt = Date.now()
  private temporary: { state: PetRuntimeState; until: number } | null = null
  private lastEatTokenAt = 0
  private lastStateAt = 0
  private lastState: PetRuntimeState = 'idle'

  apply(events: readonly PetEvent[], activeAgents: number): PetStateSnapshot | null {
    let changed = false
    for (const event of events) {
      switch (event.type) {
        case 'TASK_STARTED':
          this.running = true
          this.hasError = false
          this.hasWarning = false
          this.temporary = null
          changed = true
          break
        case 'THINKING_STARTED':
          this.thinking = true
          changed = true
          break
        case 'THINKING_FINISHED':
          this.thinking = false
          changed = true
          break
        case 'STREAM_STARTED':
          this.streaming = true
          changed = true
          break
        case 'STREAM_FINISHED':
          this.streaming = false
          changed = true
          break
        case 'TOOL_CALL_STARTED':
          this.toolCalling = true
          changed = true
          break
        case 'TOOL_CALL_FINISHED':
          if (event.failed) this.hasWarning = true
          this.toolCalling = false
          changed = true
          break
        case 'WAITING_FOR_USER':
          if (this.waiting !== event.waiting) {
            this.waiting = event.waiting
            changed = true
          }
          break
        case 'TASK_SUCCEEDED':
          this.running = false
          this.thinking = false
          this.streaming = false
          this.toolCalling = false
          this.temporary = { state: 'success', until: Date.now() + SUCCESS_DURATION_MS }
          changed = true
          break
        case 'TASK_FAILED':
          this.running = false
          this.thinking = false
          this.streaming = false
          this.toolCalling = false
          this.temporary = { state: 'failed', until: Date.now() + FAILED_DURATION_MS }
          changed = true
          break
        case 'WARNING':
          this.hasWarning = true
          this.temporary = { state: 'warning', until: Date.now() + WARNING_DURATION_MS }
          changed = true
          break
        case 'WARNING_CLEARED':
          this.hasWarning = false
          changed = true
          break
        case 'RUNTIME_SETTLED':
          this.running = false
          this.thinking = false
          this.streaming = false
          this.toolCalling = false
          changed = true
          break
        case 'SESSION_CREATED':
        case 'USER_ACTIVITY':
          break
      }
      if (
        event.type === 'TASK_STARTED' ||
        event.type === 'THINKING_STARTED' ||
        event.type === 'STREAM_STARTED' ||
        event.type === 'TOOL_CALL_STARTED'
      ) {
        this.lastActivityAt = Date.now()
      }
    }
    if (activeAgents > 0) this.lastActivityAt = Date.now()
    if (!changed && !this.expiredTemporary()) return null
    return this.snapshot()
  }

  /** Called periodically so sleep and temporary-expiry happen without events. */
  tick(): PetStateSnapshot | null {
    return this.expiredTemporary() ? this.snapshot() : null
  }

  /** True when an eat_token may play right now (throttled while streaming). */
  canEatToken(now: number): boolean {
    if (!this.streaming) return false
    if (now - this.lastEatTokenAt < PET_EAT_TOKEN_MIN_INTERVAL_MS) return false
    this.lastEatTokenAt = now
    return true
  }

  private expiredTemporary(): boolean {
    if (!this.temporary) return false
    if (Date.now() < this.temporary.until) return false
    this.temporary = null
    return true
  }

  private snapshot(): PetStateSnapshot | null {
    const state = this.resolve()
    // Merge-guard: identical states within the guard window do not restart clips.
    if (state === this.lastState && Date.now() - this.lastStateAt < PET_MIN_STATE_DURATION_MS) {
      return null
    }
    this.lastState = state
    this.lastStateAt = Date.now()
    return { state }
  }

  private resolve(): PetRuntimeState {
    if (this.temporary) return this.temporary.state
    if (this.waiting) return 'waiting'
    if (this.hasError) return 'failed'
    if (Date.now() - this.lastActivityAt > PET_SLEEP_TIMEOUT_MS) return 'sleeping'
    if (this.toolCalling) return 'tool-calling'
    if (this.thinking) return 'thinking'
    if (this.running || this.streaming) return 'running'
    if (this.hasWarning) return 'warning'
    return 'idle'
  }
}
