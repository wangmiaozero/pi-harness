import type { AgentStateSnapshot } from '@shared/types/workspace'
import type {
  HarnessCapabilities,
  HarnessState,
  HarnessStats,
  HarnessTool
} from '@shared/types/harness'

export function mapHarnessState(
  snapshot: AgentStateSnapshot,
  capabilities: HarnessCapabilities,
  tools: HarnessTool[],
  thinkingOptions: string[],
  stats?: HarnessStats
): HarnessState {
  const context = snapshot.contextUsage
  const percent = context
    ? normalizePercent(
        context.percent,
        context.tokens !== null && context.contextWindow > 0
          ? (context.tokens / context.contextWindow) * 100
          : null
      )
    : null

  return {
    sessionId: snapshot.sessionId,
    runtime: {
      status:
        snapshot.status === 'compacting'
          ? 'compacting'
          : snapshot.status === 'running' || snapshot.status === 'starting'
            ? 'running'
            : 'idle',
      isStreaming: snapshot.isStreaming,
      isPromptRunning: snapshot.isPromptRunning,
      isBashRunning: snapshot.isBashRunning,
      isCompacting: snapshot.isCompacting
    },
    ...(snapshot.model ? { model: snapshot.model } : {}),
    thinking: {
      level: snapshot.thinkingLevel,
      options: thinkingOptions.includes(snapshot.thinkingLevel)
        ? thinkingOptions
        : [...thinkingOptions, snapshot.thinkingLevel]
    },
    context: context
      ? {
          tokens: context.tokens,
          contextWindow: context.contextWindow,
          percent
        }
      : null,
    compaction: {
      auto: snapshot.autoCompactionEnabled,
      running: snapshot.isCompacting
    },
    queue: {
      pendingMessages: snapshot.pendingMessageCount,
      steering: [...snapshot.queuedMessages.steering],
      followUp: [...snapshot.queuedMessages.followUp]
    },
    tools,
    capabilities,
    ...(stats ? { stats } : {})
  }
}

function normalizePercent(value: number | null, fallback: number | null): number | null {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  if (candidate === null || !Number.isFinite(candidate)) return null
  return Math.min(100, Math.max(0, candidate))
}
