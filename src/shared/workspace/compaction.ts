import { COMPACTION_POLICY } from './compaction-policy'

export type CompactionSource = 'workspace' | 'command-palette' | 'harness'

export type CompactionResult =
  | {
      status: 'compacted'
      tokensBefore?: number
      tokensAfter?: number
      firstKeptEntryId?: string
    }
  | { status: 'queued' }
  | { status: 'already-running' }
  | { status: 'session-too-small' }
  | { status: 'already-compacted' }
  | { status: 'session-missing' }
  | { status: 'unsupported' }
  | { status: 'declined' }
  | { status: 'failed'; error: unknown }

export type CompactionUsageHint = 'unknown' | 'low' | 'ready' | 'recommend' | 'urgent'

export type CompactionBusyKind = 'compacting' | 'working'

export function canRequestCompaction(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId)
}

export function compactionUsageRatio(
  usage:
    | {
        tokens?: number | null
        contextWindow?: number | null
      }
    | null
    | undefined
): number | null {
  const tokens = usage?.tokens
  const contextWindow = usage?.contextWindow
  if (
    typeof tokens !== 'number' ||
    !Number.isFinite(tokens) ||
    typeof contextWindow !== 'number' ||
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0
  ) {
    return null
  }
  return tokens / contextWindow
}

export function compactionUsageHint(ratio: number | null): CompactionUsageHint {
  if (ratio === null) return 'unknown'
  if (ratio < COMPACTION_POLICY.lowContentRatio) return 'low'
  if (ratio < COMPACTION_POLICY.suggestContextRatio) return 'ready'
  if (ratio < COMPACTION_POLICY.autoContextRatio) return 'recommend'
  return 'urgent'
}

export function inspectCompactionBusy(input: {
  sending?: boolean
  isStreaming?: boolean
  isPromptRunning?: boolean
  isBashRunning?: boolean
  isCompacting?: boolean
  running?: boolean
}): CompactionBusyKind | null {
  if (input.isCompacting) return 'compacting'
  if (
    input.sending ||
    input.isStreaming ||
    input.isPromptRunning ||
    input.isBashRunning ||
    input.running
  ) {
    return 'working'
  }
  return null
}

export function parseCompactionRuntimeResult(raw: unknown): CompactionResult {
  if (raw == null) return { status: 'compacted' }
  if (typeof raw !== 'object') return { status: 'compacted' }
  const record = raw as Record<string, unknown>
  if (record.reason === 'session-too-small') return { status: 'session-too-small' }
  if (record.reason === 'already-compacted') return { status: 'already-compacted' }
  const tokensBefore = asFiniteNumber(record.tokensBefore)
  const firstKeptEntryId =
    typeof record.firstKeptEntryId === 'string' && record.firstKeptEntryId
      ? record.firstKeptEntryId
      : undefined
  if (record.cancelled === true && tokensBefore === undefined && !firstKeptEntryId) {
    return { status: 'failed', error: raw }
  }
  return {
    status: 'compacted',
    ...(tokensBefore !== undefined ? { tokensBefore } : {}),
    ...(firstKeptEntryId ? { firstKeptEntryId } : {})
  }
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
