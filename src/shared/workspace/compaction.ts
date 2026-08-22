import type { AgentMessage, AgentStateSnapshot } from '../types/workspace'

export const MIN_MANUAL_COMPACTION_TOKENS = 20_000

export function canCompactSession(
  messages: AgentMessage[],
  state: AgentStateSnapshot | null,
  busy = false
): boolean {
  if (busy || !state || state.isStreaming || state.isPromptRunning || state.isCompacting) {
    return false
  }
  const tokens = state.contextUsage?.tokens ?? 0
  if (tokens <= MIN_MANUAL_COMPACTION_TOKENS) return false
  return messages.filter((message) => message.role === 'user').length >= 2
}
