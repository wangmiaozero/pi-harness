/**
 * Harness DTOs (runtime-local subset of `src/shared/types/harness.ts`).
 *
 * Only the phase-2 surface: capabilities, tools, state, session tree,
 * fork/compaction results, events and the timeline item shape. Runs,
 * checkpoints, policies, orchestration, diagnostics arrive with later
 * phases and stay in the shared module (Electron-only until then).
 */

export type HarnessRuntimeStatus = 'idle' | 'running' | 'compacting' | 'stopped'

export interface HarnessCapabilities {
  prompt: boolean
  abort: boolean
  steering: boolean
  followUp: boolean
  compaction: boolean
  autoCompaction: boolean
  thinkingLevel: boolean
  tools: boolean
  sessionFork: boolean
  sessionTree: boolean
  modelSwitch: boolean
  contextUsage: boolean
  stats: boolean
}

export interface HarnessTool {
  name: string
  description: string
  active: boolean
}

export interface HarnessStats {
  sessionId: string
  sessionName?: string
  userMessages?: number
  assistantMessages?: number
  toolCalls?: number
  toolResults?: number
  totalMessages?: number
  tokens?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost?: number
  activeTools: number
  pendingMessages: number
}

export interface HarnessState {
  sessionId: string
  runtime: {
    status: HarnessRuntimeStatus
    isStreaming: boolean
    isPromptRunning: boolean
    isBashRunning: boolean
    isCompacting: boolean
  }
  model?: {
    provider: string
    id: string
  }
  thinking: {
    level: string
    options: string[]
  }
  context: {
    tokens: number | null
    contextWindow: number
    percent: number | null
  } | null
  compaction: {
    auto: boolean
    running: boolean
  }
  queue: {
    pendingMessages: number
    steering: string[]
    followUp: string[]
  }
  tools: HarnessTool[]
  capabilities: HarnessCapabilities
  stats?: HarnessStats
}

export interface HarnessSessionEntry {
  id: string
  parentId: string | null
  type: string
  role?: string
  timestamp?: string
  label?: string
  active: boolean
}

export interface HarnessSessionInfo {
  sessionId: string
  name?: string
  persisted: boolean
  leafId: string | null
  entries: HarnessSessionEntry[]
}

export interface HarnessForkResult {
  cancelled?: boolean
  newSessionId?: string
}

export interface HarnessCompactionResult {
  cancelled?: boolean
  reason?: 'session-too-small' | 'already-compacted'
}

interface HarnessEventBase {
  timestamp: number
}

export type HarnessEvent =
  | (HarnessEventBase & { type: 'session.started' | 'session.stopped' })
  | (HarnessEventBase & { type: 'runtime.started' | 'runtime.idle' | 'runtime.aborted' })
  | (HarnessEventBase & {
      type: 'prompt.started'
      message?: string
    })
  | (HarnessEventBase & { type: 'prompt.completed' })
  | (HarnessEventBase & {
      type: 'message.started' | 'message.completed'
      usage?: {
        input: number
        output: number
        cacheRead: number
        cacheWrite: number
        total: number
        cost: number | null
      }
      model?: string
      provider?: string
    })
  | (HarnessEventBase & {
      type: 'tool.started' | 'tool.completed'
      toolCallId?: string
      toolName: string
      isError?: boolean
    })
  | (HarnessEventBase & {
      type: 'compaction.started' | 'compaction.completed'
      automatic: boolean
      aborted?: boolean
    })
  | (HarnessEventBase & {
      type: 'compaction.skipped'
      reason: 'session-too-small' | 'already-compacted'
    })
  | (HarnessEventBase & {
      type: 'queue.changed'
      steering: number
      followUp: number
    })
  | (HarnessEventBase & { type: 'steering.queued' | 'followUp.queued' })
  | (HarnessEventBase & { type: 'thinking.changed'; level: string })
  | (HarnessEventBase & { type: 'model.changed'; provider: string; modelId: string })
  | (HarnessEventBase & { type: 'tools.changed'; active: number })
  | (HarnessEventBase & { type: 'autoCompaction.changed'; enabled: boolean })
  | (HarnessEventBase & { type: 'session.forked'; newSessionId: string })
  | (HarnessEventBase & { type: 'session.navigated'; targetId: string })
  | (HarnessEventBase & {
      type: 'context.updated'
      tokens: number | null
      contextWindow: number
      percent: number | null
    })
  | (HarnessEventBase & { type: 'runtime.error'; message: string })

export interface HarnessEventEnvelope {
  sessionId: string
  event: HarnessEvent
}

/** Replayable harness timeline entry (in-memory ring buffer per session). */
export interface HarnessTimelineItem {
  event: HarnessEvent
}

/** Timings surfaced through `runtime.status` (§36 metrics). */
export interface RuntimeTimings {
  runtimeStartMs: number
  piSdkLoadMs: number | null
  firstAgentStartMs: number | null
}
