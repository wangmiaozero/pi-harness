import { COMPACTION_POLICY } from './compaction-policy'
import type { RuntimeErrorKind } from './runtime-error'

/**
 * Per active model: Pi compacts natively once tokens exceed
 * `contextWindow - reserveTokens`. Smart compaction uses that model's live
 * `contextWindow` (and its reserve) to start earlier — ratio of the window,
 * capped by `maxTokens` — so a 128K model and a 1M model get different
 * thresholds. Switching models recomputes immediately.
 */
export interface SmartCompactionSettings {
  enabled: boolean
  /** Fraction of the effective context window. */
  ratio: number
  /** Absolute ceiling for very large windows. */
  maxTokens: number
}

export const SMART_COMPACTION_RATIOS = [0.6, 0.7, 0.8, 0.9] as const
export const SMART_COMPACTION_MAX_TOKENS = [128_000, 256_000, 512_000, 1_000_000] as const

export const DEFAULT_SMART_COMPACTION: SmartCompactionSettings = {
  enabled: true,
  ratio: COMPACTION_POLICY.autoContextRatio,
  maxTokens: 256_000
}

export function normalizeSmartCompaction(value: unknown): SmartCompactionSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<
    Record<keyof SmartCompactionSettings, unknown>
  >
  const ratio = SMART_COMPACTION_RATIOS.find((option) => option === input.ratio)
  const maxTokens = SMART_COMPACTION_MAX_TOKENS.find((option) => option === input.maxTokens)
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_SMART_COMPACTION.enabled,
    ratio: ratio ?? DEFAULT_SMART_COMPACTION.ratio,
    maxTokens: maxTokens ?? DEFAULT_SMART_COMPACTION.maxTokens
  }
}

/** Tokens at which smart compaction starts; never later than Pi's native threshold. */
export function smartCompactionThreshold(input: {
  contextWindow: number | null | undefined
  reserveTokens: number | null | undefined
  settings: SmartCompactionSettings
}): number | null {
  const window = input.contextWindow
  if (typeof window !== 'number' || !Number.isFinite(window) || window <= 0) return null
  const reserve =
    typeof input.reserveTokens === 'number' && Number.isFinite(input.reserveTokens)
      ? Math.max(0, input.reserveTokens)
      : 0
  const native = window - reserve
  const smart = Math.min(Math.floor(window * input.settings.ratio), input.settings.maxTokens)
  const threshold = Math.min(smart, native)
  return threshold > 0 ? threshold : null
}

export type CompactionTrigger = 'smart' | 'threshold' | 'overflow' | 'manual'

/** Per-session compaction state reported by Main from Pi's lifecycle events. */
export interface CompactionStatus {
  /** Smart compaction is active for this session (settings and Pi auto-compaction both on). */
  smartEnabled: boolean
  /** Pi's own automatic compaction setting. */
  autoEnabled: boolean
  threshold: number | null
  phase: 'idle' | 'compacting' | 'succeeded' | 'failed'
  trigger?: CompactionTrigger
  tokensBefore?: number
  tokensAfter?: number
  error?: string
  errorKind?: RuntimeErrorKind
  updatedAt?: number
  /** Smart compaction is paused until this time after failures. */
  retryAt?: number
}
