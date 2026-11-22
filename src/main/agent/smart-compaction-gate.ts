import type { AgentEvent } from '@shared/types/workspace'
import { inspectRuntimeError } from '@shared/workspace/runtime-error'
import {
  DEFAULT_SMART_COMPACTION,
  smartCompactionThreshold,
  type CompactionStatus,
  type CompactionTrigger,
  type SmartCompactionSettings
} from '@shared/workspace/smart-compaction'

export interface SmartCompactionUsage {
  tokens: number | null
  contextWindow: number
  autoEnabled: boolean
  reserveTokens?: number
}

export interface SmartCompactionLiveState {
  usage: { tokens: number | null; contextWindow: number } | null
  autoEnabled: boolean
  reserveTokens?: number
  idle: boolean
}

export interface SmartCompactionProbe {
  read(): Promise<SmartCompactionLiveState>
  /** Pi's native compaction; resolves with its result or `{ cancelled: true }`. */
  compact(): Promise<unknown>
  emit(event: AgentEvent): void
}

export type SmartCompactionOutcome =
  | { status: 'succeeded'; tokensBefore?: number; tokensAfter?: number }
  | { status: 'skipped' | 'aborted' }
  | { status: 'failed'; errorMessage: string }

type SessionState = Omit<CompactionStatus, 'smartEnabled' | 'autoEnabled' | 'threshold'> & {
  running?: { promise: Promise<void>; resolve: () => void; tokens: number; threshold: number }
  hysteresis: number
  failures: number
  suppressBelow?: number
}

export const SMART_COMPACTION_FAILURE_LIMIT = 3
const BASE_COOLDOWN_MS = 2 * 60_000
const MAX_COOLDOWN_MS = 30 * 60_000
const RATE_LIMIT_COOLDOWN_MS = 60_000
const NOOP_COMPACTION = /Nothing to compact|session too small|Already compacted/i
const ABORTED_COMPACTION = /Compaction cancelled|aborted/i

/**
 * Keeps long sessions working: when real usage crosses an early threshold, run
 * Pi's own compaction (current user model, recent context kept) before the next
 * prompt, then continue. Older history may be summarized away. Failures cool
 * down in bursts and never block the prompt; Pi still owns overflow recovery.
 */
export class SmartCompactionGate {
  private readonly sessions = new Map<string, SessionState>()

  constructor(
    private settings: () => SmartCompactionSettings = () => DEFAULT_SMART_COMPACTION,
    private readonly now: () => number = Date.now
  ) {}

  configure(settings: () => SmartCompactionSettings): void {
    this.settings = settings
  }

  getSettings(): SmartCompactionSettings {
    return this.settings()
  }

  isRunning(sessionId: string): boolean {
    return Boolean(this.sessions.get(sessionId)?.running)
  }

  /** Waits for an in-flight smart compaction; true when it compacted the session. */
  async settle(sessionId: string): Promise<boolean> {
    const state = this.sessions.get(sessionId)
    if (!state?.running) return false
    await state.running.promise
    return state.phase === 'succeeded' && state.trigger === 'smart'
  }

  forget(sessionId: string): void {
    this.sessions.get(sessionId)?.running?.resolve()
    this.sessions.delete(sessionId)
  }

  /** Claims the session's compaction slot when usage crosses the threshold. */
  decide(sessionId: string, usage: SmartCompactionUsage): { threshold: number } | null {
    const settings = this.settings()
    if (!settings.enabled || !usage.autoEnabled) return null
    const tokens = usage.tokens
    const threshold = smartCompactionThreshold({
      contextWindow: usage.contextWindow,
      reserveTokens: usage.reserveTokens,
      settings
    })
    // Unknown usage (e.g. right after a compaction) or limits fall back to Pi's native policy.
    if (threshold === null || typeof tokens !== 'number' || !Number.isFinite(tokens)) return null
    if (tokens < threshold) return null
    const state = this.state(sessionId)
    if (state.running) return null
    if (state.retryAt && this.now() < state.retryAt) return null
    // After a cool-down, allow another burst so long sessions keep compacting.
    if (state.failures >= SMART_COMPACTION_FAILURE_LIMIT) state.failures = 0
    if (state.suppressBelow !== undefined && tokens < state.suppressBelow) return null
    let resolve!: () => void
    const promise = new Promise<void>((done) => (resolve = done))
    state.running = { promise, resolve, tokens, threshold }
    state.hysteresis = Math.max(16_384, Math.round(usage.contextWindow * 0.05))
    Object.assign(state, {
      phase: 'compacting',
      trigger: 'smart',
      error: undefined,
      errorKind: undefined,
      updatedAt: this.now()
    })
    return { threshold }
  }

  report(sessionId: string, outcome: SmartCompactionOutcome): void {
    const state = this.sessions.get(sessionId)
    const running = state?.running
    if (!state || !running) return
    state.running = undefined
    state.updatedAt = this.now()
    try {
      if (outcome.status === 'skipped') {
        // Nothing Pi can compact yet; wait for meaningful growth before trying again.
        state.suppressBelow = running.tokens + state.hysteresis
        state.phase = 'idle'
        return
      }
      if (outcome.status === 'aborted') {
        state.phase = 'idle'
        return
      }
      if (outcome.status === 'failed') {
        const info = inspectRuntimeError(outcome.errorMessage)
        state.failures += 1
        const backoff = Math.min(BASE_COOLDOWN_MS * 2 ** (state.failures - 1), MAX_COOLDOWN_MS)
        state.retryAt =
          this.now() +
          (info.kind === 'rate_limit'
            ? Math.max(backoff, info.retryAfterMs ?? RATE_LIMIT_COOLDOWN_MS)
            : backoff)
        Object.assign(state, { phase: 'failed', error: info.userMessage, errorKind: info.kind })
        return
      }
      if (outcome.status !== 'succeeded') return
      const after = outcome.tokensAfter
      Object.assign(state, {
        phase: 'succeeded',
        tokensBefore: outcome.tokensBefore ?? running.tokens,
        tokensAfter: after,
        error: undefined,
        errorKind: undefined
      })
      state.failures = 0
      state.retryAt = undefined
      // A checkpoint that cannot get below the threshold must not repeat on every turn.
      state.suppressBelow =
        after !== undefined && after >= running.threshold * 0.85
          ? Math.max(after, running.threshold) + state.hysteresis
          : undefined
    } finally {
      running.resolve()
    }
  }

  observe(sessionId: string, event: { type: string; [key: string]: unknown }): void {
    if (event.type === 'compaction_start' || event.type === 'auto_compaction_start') {
      const state = this.state(sessionId)
      Object.assign(state, {
        phase: 'compacting',
        trigger: state.running || state.trigger === 'smart' ? 'smart' : triggerOf(event),
        error: undefined,
        errorKind: undefined,
        updatedAt: this.now()
      })
      return
    }
    if (event.type !== 'compaction_end' && event.type !== 'auto_compaction_end') return
    const state = this.state(sessionId)
    // The smart outcome is reported separately with its own bookkeeping.
    if (state.running) return
    const result = event.result as { tokensBefore?: unknown; estimatedTokensAfter?: unknown }
    state.updatedAt = this.now()
    // Keep "smart" when Pi reports the manual compact that the gate just ran.
    if (state.trigger !== 'smart') state.trigger = triggerOf(event)
    if (event.aborted === true) {
      if (state.trigger !== 'smart') state.phase = 'idle'
      return
    }
    if (result && typeof result === 'object') {
      Object.assign(state, {
        phase: 'succeeded',
        tokensBefore: finite(result.tokensBefore) ?? state.tokensBefore,
        tokensAfter: finite(result.estimatedTokensAfter) ?? state.tokensAfter,
        error: undefined,
        errorKind: undefined
      })
      if (state.trigger !== 'smart') {
        state.failures = 0
        state.retryAt = undefined
        state.suppressBelow = undefined
      }
      return
    }
    if (typeof event.errorMessage === 'string' && event.errorMessage.trim()) {
      const info = inspectRuntimeError(event.errorMessage)
      if (info.kind === 'aborted') {
        if (state.trigger !== 'smart') state.phase = 'idle'
        return
      }
      Object.assign(state, { phase: 'failed', error: info.userMessage, errorKind: info.kind })
    }
  }

  status(
    sessionId: string,
    live: Omit<SmartCompactionLiveState, 'idle'> | null
  ): CompactionStatus | undefined {
    if (!live) return undefined
    const settings = this.settings()
    const smartEnabled = settings.enabled && live.autoEnabled
    const window = live.usage?.contextWindow
    const threshold = smartEnabled
      ? smartCompactionThreshold({
          contextWindow: window,
          reserveTokens: live.reserveTokens,
          settings
        })
      : live.autoEnabled && typeof window === 'number' && window > 0
        ? Math.max(0, window - (live.reserveTokens ?? 0)) || null
        : null
    const state = this.sessions.get(sessionId)
    const retryAt = state?.retryAt && state.retryAt > this.now() ? state.retryAt : undefined
    return {
      smartEnabled,
      autoEnabled: live.autoEnabled,
      threshold,
      phase: state?.phase ?? 'idle',
      ...(state?.trigger ? { trigger: state.trigger } : {}),
      ...(state?.tokensBefore !== undefined ? { tokensBefore: state.tokensBefore } : {}),
      ...(state?.tokensAfter !== undefined ? { tokensAfter: state.tokensAfter } : {}),
      ...(state?.error ? { error: state.error, errorKind: state.errorKind } : {}),
      ...(state?.updatedAt ? { updatedAt: state.updatedAt } : {}),
      ...(retryAt ? { retryAt } : {})
    }
  }

  /** Compacts an idle session before its next prompt; never blocks the prompt on failure. */
  async beforePrompt(sessionId: string, probe: SmartCompactionProbe): Promise<void> {
    // Another prompt already compacted this session; continue working with that result.
    if (await this.settle(sessionId)) return
    if (!this.settings().enabled) return
    const live = await probe.read()
    if (!live.idle || !live.usage) return
    const decision = this.decide(sessionId, {
      tokens: live.usage.tokens,
      contextWindow: live.usage.contextWindow,
      autoEnabled: live.autoEnabled,
      reserveTokens: live.reserveTokens
    })
    if (!decision) return
    probe.emit({
      type: 'smart_compaction_start',
      tokens: live.usage.tokens,
      threshold: decision.threshold
    })
    const outcome = await compactOutcome(probe)
    this.report(sessionId, outcome)
    probe.emit({
      type: 'smart_compaction_end',
      status: outcome.status,
      ...(outcome.status === 'failed' ? { errorMessage: outcome.errorMessage } : {})
    })
  }

  private state(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId)
    if (!state) {
      state = { phase: 'idle', failures: 0, hysteresis: 16_384 }
      this.sessions.set(sessionId, state)
    }
    return state
  }
}

async function compactOutcome(probe: SmartCompactionProbe): Promise<SmartCompactionOutcome> {
  try {
    const result = (await probe.compact()) as
      | { cancelled?: boolean; tokensBefore?: unknown; estimatedTokensAfter?: unknown }
      | null
      | undefined
    if (result?.cancelled) return { status: 'skipped' }
    return {
      status: 'succeeded',
      tokensBefore: finite(result?.tokensBefore),
      tokensAfter: finite(result?.estimatedTokensAfter)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (NOOP_COMPACTION.test(message)) return { status: 'skipped' }
    if (ABORTED_COMPACTION.test(message)) return { status: 'aborted' }
    return { status: 'failed', errorMessage: message }
  }
}

function triggerOf(event: { reason?: unknown; type: string }): CompactionTrigger {
  if (event.reason === 'manual' || event.reason === 'overflow' || event.reason === 'threshold')
    return event.reason
  return event.type.startsWith('auto_') ? 'threshold' : 'manual'
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export const smartCompactionGate = new SmartCompactionGate()
