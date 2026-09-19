export const COMPACTION_POLICY = {
  lowContentRatio: 0.3,
  suggestContextRatio: 0.7,
  autoContextRatio: 0.8,
  criticalContextRatio: 0.9,
  manyMessages: 40
} as const

export type CompactionDecisionReason =
  | 'context-high'
  | 'context-medium'
  | 'many-messages'
  | 'long-session'
  | 'recently-compacted'
  | 'too-little-content'
  | 'manual'

export type CompactionDecision = {
  canRun: boolean
  shouldCompact: boolean
  reason: CompactionDecisionReason
  ratio: number | null
}

export function evaluateCompactionNeed(input: {
  sessionId?: string | null
  usage?: { tokens?: number | null; contextWindow?: number | null } | null
  messageCount?: number
  busy?: 'compacting' | 'working' | null
  recentlyCompacted?: boolean
}): CompactionDecision {
  const ratio = readUsageRatio(input.usage)
  const messageCount = input.messageCount ?? 0
  const canRun = Boolean(input.sessionId) && input.busy !== 'compacting'

  if (input.recentlyCompacted) {
    return { canRun, shouldCompact: false, reason: 'recently-compacted', ratio }
  }
  if (ratio !== null && ratio >= COMPACTION_POLICY.criticalContextRatio) {
    return { canRun, shouldCompact: true, reason: 'context-high', ratio }
  }
  if (ratio !== null && ratio >= COMPACTION_POLICY.autoContextRatio) {
    return { canRun, shouldCompact: true, reason: 'context-high', ratio }
  }
  if (ratio !== null && ratio >= COMPACTION_POLICY.suggestContextRatio) {
    return { canRun, shouldCompact: true, reason: 'context-medium', ratio }
  }
  if (messageCount >= COMPACTION_POLICY.manyMessages) {
    return { canRun, shouldCompact: true, reason: 'many-messages', ratio }
  }
  if (ratio !== null && ratio < COMPACTION_POLICY.lowContentRatio) {
    return { canRun, shouldCompact: false, reason: 'too-little-content', ratio }
  }
  if (typeof input.usage?.tokens === 'number' && input.usage.tokens >= 24_000) {
    return { canRun, shouldCompact: true, reason: 'long-session', ratio }
  }
  return { canRun, shouldCompact: true, reason: 'manual', ratio }
}

function readUsageRatio(
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
