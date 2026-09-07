/** Stable desktop DTOs for inspecting and controlling Pi Agent Harness. */

export type HarnessRuntimeStatus = 'idle' | 'running' | 'compacting' | 'stopped'

export type HarnessErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_NOT_RUNNING'
  | 'MODEL_NOT_FOUND'
  | 'TOOL_NOT_FOUND'
  | 'COMPACTION_NOT_AVAILABLE'
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'PI_SDK_NOT_AVAILABLE'
  | 'AGENT_RUNNING'
  | 'BASH_RUNNING'
  | 'POLICY_DENIED'
  | 'BUDGET_EXCEEDED'
  | 'CHECKPOINT_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'INVALID_STATE'

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

// ---------------------------------------------------------------------------
// Runs — one Agent turn (prompt → assistant work → settlement) inside a session.
// A Session may produce many Runs; Runs never replace Sessions.
// ---------------------------------------------------------------------------

export type HarnessRunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'tool-calling'
  | 'verifying'
  | 'success'
  | 'failed'
  | 'aborted'
  | 'recovered'

export type HarnessRunStepKind = 'message' | 'tool' | 'compaction' | 'policy' | 'error'

export interface HarnessRunStep {
  id: string
  kind: HarnessRunStepKind
  name: string
  status: 'running' | 'success' | 'failed' | 'skipped'
  startedAt: number
  finishedAt?: number
  detail?: string
}

export interface HarnessRunUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  totalTokens: number
  /** Estimated cost in USD. Pi-reported when available — never an official bill. */
  estimatedCost: number | null
}

export interface HarnessRun {
  id: string
  sessionId: string
  parentRunId: string | null
  status: HarnessRunStatus
  /** `live` runs were observed in this app; `history` runs were reconstructed from the session JSONL. */
  source: 'live' | 'history'
  startedAt: number
  finishedAt: number | null
  model: string | null
  provider: string | null
  prompt: string
  usage: HarnessRunUsage
  toolCallCount: number
  toolFailureCount: number
  contextUsage: {
    percent: number | null
    contextWindow: number
    tokens: number | null
  } | null
  result: string | null
  error: string | null
  /** Set when a Budget Policy limit was exceeded during this run. */
  budgetExceeded: string | null
  steps: HarnessRunStep[]
  checkpointIds: string[]
}

// ---------------------------------------------------------------------------
// Policy — the Harness governance layer evaluated before the agent acts.
// ---------------------------------------------------------------------------

export type HarnessPolicyDecision = 'allow' | 'ask' | 'deny'

export interface HarnessPolicyBudget {
  maxTokens: number | null
  maxCost: number | null
  maxToolCalls: number | null
  maxRunDurationMs: number | null
}

export interface HarnessPolicyConfig {
  schemaVersion: 1
  tools: {
    default: HarnessPolicyDecision
    overrides: Record<string, HarnessPolicyDecision>
  }
  files: {
    write: HarnessPolicyDecision
    delete: HarnessPolicyDecision
    rename: HarnessPolicyDecision
    outsideWorkspace: HarnessPolicyDecision
  }
  shell: {
    default: HarnessPolicyDecision
    allowCommands: string[]
    denyCommands: string[]
    dangerousConfirmation: boolean
  }
  git: {
    commit: HarnessPolicyDecision
    push: HarnessPolicyDecision
    forcePush: HarnessPolicyDecision
    reset: HarnessPolicyDecision
    checkout: HarnessPolicyDecision
    branchDelete: HarnessPolicyDecision
  }
  network: HarnessPolicyDecision
  budget: HarnessPolicyBudget
  evaluation: {
    autoEvaluate: boolean
  }
  checkpoints: {
    autoPreRun: boolean
  }
}

export interface HarnessPolicySnapshot {
  config: HarnessPolicyConfig
  /** Built-in dangerous-command patterns that trigger `ask` confirmation. */
  dangerousPatterns: string[]
  updatedAt: number
}

export type HarnessPolicyDomain =
  | 'tool'
  | 'file'
  | 'shell'
  | 'git'
  | 'network'
  | 'budget'

export interface HarnessPolicyDecisionReport {
  sessionId: string
  domain: HarnessPolicyDomain
  decision: HarnessPolicyDecision
  /** What was evaluated, e.g. a tool name, command, or file action. */
  target: string
  rule: string
  allowed: boolean
}

// ---------------------------------------------------------------------------
// Checkpoints — explicit recovery anchors. A checkpoint records what is true;
// recovery reuses Pi's own navigate/fork capabilities instead of faking rollback.
// ---------------------------------------------------------------------------

export type HarnessCheckpointKind = 'logical' | 'git' | 'session'

export interface HarnessCheckpoint {
  id: string
  runId: string | null
  sessionId: string
  createdAt: number
  reason: 'manual' | 'pre-run' | 'post-run' | 'pre-recovery'
  kind: HarnessCheckpointKind
  sessionEntryId: string | null
  gitCommit: string | null
  gitBranch: string | null
  gitDirtyState: { modified: number; added: number; deleted: number } | null
  contextState: { percent: number | null; tokens: number | null } | null
  metadata: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Evaluation — engineering verification over real run evidence.
// ---------------------------------------------------------------------------

export interface HarnessEvaluationCheck {
  id: string
  name: string
  status: 'passed' | 'warning' | 'failed'
  message: string
  evidence?: string
}

export interface HarnessEvaluation {
  runId: string
  sessionId: string
  evaluatedAt: number
  status: 'passed' | 'warning' | 'failed'
  checks: HarnessEvaluationCheck[]
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
  | (HarnessEventBase & {
      type: 'run.started'
      runId: string
      prompt: string
    })
  | (HarnessEventBase & {
      type: 'run.completed'
      runId: string
      status: HarnessRunStatus
    })
  | (HarnessEventBase & { type: 'run.failed'; runId: string; error?: string })
  | (HarnessEventBase & { type: 'run.aborted'; runId: string })
  | (HarnessEventBase & {
      type: 'checkpoint.created'
      checkpointId: string
      reason: string
    })
  | (HarnessEventBase & {
      type: 'policy.allowed' | 'policy.denied'
      domain: HarnessPolicyDomain
      target: string
      rule: string
    })
  | (HarnessEventBase & {
      type: 'policy.confirmed'
      domain: HarnessPolicyDomain
      target: string
      allowed: boolean
    })
  | (HarnessEventBase & {
      type: 'budget.exceeded'
      runId: string
      limit: string
      value: string
    })
  | (HarnessEventBase & { type: 'evaluation.started'; runId: string })
  | (HarnessEventBase & {
      type: 'evaluation.completed'
      runId: string
      status: 'passed' | 'warning' | 'failed'
    })
  | (HarnessEventBase & {
      type: 'recovery.started' | 'recovery.completed'
      kind: 'resume' | 'fork' | 'retry'
      checkpointId?: string
      runId?: string
    })

export interface HarnessEventEnvelope {
  sessionId: string
  event: HarnessEvent
}
