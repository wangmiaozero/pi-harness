// @ts-nocheck
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
  | 'FORK_FAILED'
  | 'EXPORT_FAILED'
  | 'ORCHESTRATION_NOT_FOUND'
  | 'AGENT_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'TEMPLATE_NOT_FOUND'
  | 'TEAM_NOT_FOUND'
  | 'DEPENDENCY_CYCLE'
  | 'ORCHESTRATION_NOT_RUNNING'
  | 'ORCHESTRATION_BUSY'
  | 'HANDOFF_NOT_FOUND'
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

export type HarnessRunRelation =
  | 'original'
  | 'fork'
  | 'retry'
  | 'recovery'
  | 'rerun'

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
  /** Why this run exists relative to its origin (sequential turns are `original`). */
  relation: HarnessRunRelation
  /** Run this run was forked / re-run from (cross-session tree edge). */
  forkedFromRunId: string | null
  /** Trace replay event this run was forked from, when the user picked one. */
  forkedFromEventId: string | null
  /** Checkpoint this run was forked / recovered from. */
  forkedFromCheckpointId: string | null
  status: HarnessRunStatus
  /** `live` runs were observed in this app; `history` runs were reconstructed from the session JSONL. */
  source: 'live' | 'history'
  /** Session entry this run is anchored to (dedupe against reconstructed history). */
  anchorEntryId: string | null
  /** Working directory of the session — the project a run belongs to. */
  cwd: string | null
  /** Agent that executed this run (multi-agent orchestration). */
  agentId: string | null
  /** Task this run was dispatched for (multi-agent orchestration). */
  taskId: string | null
  /** Orchestration run this run belongs to (multi-agent orchestration). */
  orchestrationId: string | null
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

export interface HarnessRunTreeNode {
  runId: string
  sessionId: string
  prompt: string
  status: HarnessRunStatus
  relation: HarnessRunRelation
  startedAt: number
  model: string | null
  children: HarnessRunTreeNode[]
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
    /** Which pipeline stages are required when evaluating a run. */
    preset: HarnessEvaluationPreset
    /** Stage kinds required when `preset` is `custom`. */
    customStages: HarnessEvaluationStageKind[]
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

/** Stage kinds of the evaluation pipeline. Deterministic — no LLM judging. */
export type HarnessEvaluationStageKind =
  | 'static-check'
  | 'lint'
  | 'typecheck'
  | 'test'
  | 'build'
  | 'git-inspection'
  | 'custom-check'

export interface HarnessEvaluationStage {
  id: string
  kind: HarnessEvaluationStageKind
  name: string
  status: 'passed' | 'warning' | 'failed' | 'skipped'
  command: string | null
  duration: number | null
  evidence: string | null
  message: string | null
}

export type HarnessEvaluationPreset = 'fast' | 'standard' | 'strict' | 'custom'

export interface HarnessEvaluationPipeline {
  id: string
  runId: string
  name: string
  preset: HarnessEvaluationPreset
  stages: HarnessEvaluationStage[]
  finalStatus: 'passed' | 'warning' | 'failed'
  startedAt: number
  finishedAt: number
}

export interface HarnessEvaluation {
  runId: string
  sessionId: string
  evaluatedAt: number
  status: 'passed' | 'warning' | 'failed'
  checks: HarnessEvaluationCheck[]
  pipeline?: HarnessEvaluationPipeline
}

// ---------------------------------------------------------------------------
// Trace — spans and replay events derived from the real event stream.
// ---------------------------------------------------------------------------

export type HarnessTraceSpanType =
  | 'model'
  | 'tool'
  | 'shell'
  | 'file'
  | 'git'
  | 'network'
  | 'evaluation'
  | 'compaction'
  | 'checkpoint'
  | 'recovery'

export type HarnessTraceSpanStatus = 'running' | 'success' | 'failed' | 'skipped'

export interface HarnessTraceSpan {
  id: string
  runId: string
  parentSpanId: string | null
  type: HarnessTraceSpanType
  name: string
  status: HarnessTraceSpanStatus
  startedAt: number
  finishedAt: number | null
  duration: number | null
  metadata: Record<string, unknown>
  error: string | null
  /** Reserved for future multi-agent runs — always null in this version. */
  agentId?: string | null
}

/** One replayable step of a run — the real event, plus frame bookkeeping. */
export interface HarnessReplayEvent {
  id: string
  index: number
  spanId: string | null
  event: HarnessEvent
}

export interface HarnessRunTrace {
  runId: string
  sessionId: string
  /** `recorded` traces come from the live event stream; `reconstructed` from session JSONL. */
  source: 'recorded' | 'reconstructed'
  spans: HarnessTraceSpan[]
  events: HarnessReplayEvent[]
}

// ---------------------------------------------------------------------------
// Artifacts — what a run actually produced, tracked as first-class records.
// ---------------------------------------------------------------------------

export type HarnessArtifactType =
  | 'file'
  | 'diff'
  | 'patch'
  | 'log'
  | 'test-report'
  | 'build-output'
  | 'image'
  | 'document'
  | 'git-commit'
  | 'checkpoint'
  | 'other'

export interface HarnessArtifact {
  id: string
  runId: string
  sessionId: string
  type: HarnessArtifactType
  name: string
  path: string | null
  createdAt: number
  sourceEventId: string | null
  /** Agent whose run produced this artifact (multi-agent orchestration). */
  producedByAgentId: string | null
  /** Task whose run produced this artifact (multi-agent orchestration). */
  producedByTaskId: string | null
  /** Agents that consumed this artifact via handoff. */
  consumedByAgentIds: string[]
  /** Tasks that consumed this artifact via handoff. */
  consumedByTaskIds: string[]
  metadata: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Diagnostics — structured failure analysis from real trace evidence only.
// ---------------------------------------------------------------------------

export type HarnessDiagnosticSeverity = 'info' | 'warning' | 'error' | 'critical'

export type HarnessDiagnosticCategory =
  | 'tool-failure'
  | 'shell-failure'
  | 'model-failure'
  | 'provider-failure'
  | 'policy-block'
  | 'timeout'
  | 'budget-exceeded'
  | 'evaluation-failure'
  | 'user-abort'
  | 'unknown'

export interface HarnessDiagnosticCause {
  title: string
  message: string
  spanId: string | null
  eventId: string | null
}

export interface HarnessDiagnostic {
  id: string
  runId: string
  sessionId: string
  severity: HarnessDiagnosticSeverity
  category: HarnessDiagnosticCategory
  title: string
  message: string
  eventId: string | null
  spanId: string | null
  evidence: string | null
  recommendation: string | null
  causeChain: HarnessDiagnosticCause[]
}

/** Rule-generated run insight. Params feed the localized template. */
export interface HarnessInsight {
  id: string
  kind:
    | 'token-delta'
    | 'tool-failures'
    | 'duration-share'
    | 'context-compaction'
    | 'recovery'
    | 'model-share'
  params: Record<string, string | number>
}

// ---------------------------------------------------------------------------
// Regression — deterministic comparison against a baseline or previous run.
// ---------------------------------------------------------------------------

export type HarnessRegressionMetric =
  | 'tokens'
  | 'cost'
  | 'duration'
  | 'tool-calls'
  | 'tool-failures'
  | 'tests'
  | 'build'
  | 'evaluation'

export type HarnessRegressionSeverity = 'info' | 'warning' | 'regression' | 'improvement'

export interface HarnessRegressionFinding {
  id: string
  metric: HarnessRegressionMetric
  severity: HarnessRegressionSeverity
  message: string
  before: string
  after: string
  deltaPercent: number | null
}

export interface HarnessBaseline {
  cwd: string
  sessionId: string
  runId: string
  runLabel: string
  setAt: number
}

// ---------------------------------------------------------------------------
// Run Compare — metric table plus real diffs.
// ---------------------------------------------------------------------------

export interface HarnessRunComparisonMetric {
  id: string
  a: string
  b: string
  delta: string | null
  deltaPercent: number | null
  tone: 'neutral' | 'better' | 'worse'
}

export interface HarnessRunDiffLine {
  kind: 'same' | 'added' | 'removed'
  text: string
}

export interface HarnessRunDiffSection {
  id: 'prompt' | 'configuration' | 'tools' | 'files' | 'evaluation'
  lines: HarnessRunDiffLine[]
}

export interface HarnessRunComparison {
  runA: HarnessRun
  runB: HarnessRun
  metrics: HarnessRunComparisonMetric[]
  diffs: HarnessRunDiffSection[]
  findings: HarnessRegressionFinding[]
  comparedAt: number
}

// ---------------------------------------------------------------------------
// Run Detail — the single payload behind the Run Detail page.
// ---------------------------------------------------------------------------

export interface HarnessRunDetail {
  run: HarnessRun
  trace: HarnessRunTrace | null
  evaluation: HarnessEvaluation | null
  artifacts: HarnessArtifact[]
  diagnostics: HarnessDiagnostic[]
  insights: HarnessInsight[]
  regression: HarnessRegressionReport | null
}

export interface HarnessRegressionReport {
  baseline: HarnessBaseline
  findings: HarnessRegressionFinding[]
  comparedAt: number
}

// ---------------------------------------------------------------------------
// Project-level Harness Dashboard.
// ---------------------------------------------------------------------------

export type HarnessStatsRange = 'today' | '7d' | '30d' | 'all'

export interface HarnessProjectStats {
  cwd: string | null
  range: HarnessStatsRange
  sessionCount: number
  totalRuns: number
  successRate: number | null
  failureRate: number | null
  averageDurationMs: number | null
  averageTokens: number | null
  averageCost: number | null
  toolFailureRate: number | null
  evaluationPassRate: number | null
  recoveryRate: number | null
  topFailureReasons: Array<{
    category: HarnessDiagnosticCategory
    count: number
    percent: number
  }>
}

// ---------------------------------------------------------------------------
// Multi-Agent Orchestration — Agents, Tasks, Teams, Handoffs.
// Pi remains the only Agent Runtime; the orchestrator schedules real runs.
// ---------------------------------------------------------------------------

export type HarnessAgentStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'aborted'

export type HarnessAgentWorkspaceMode = 'shared' | 'worktree'

/** A reusable execution role. Instantiated into a HarnessAgent per orchestration. */
export interface AgentTemplate {
  id: string
  name: string
  role: string
  description: string | null
  systemPrompt: string | null
  provider: string | null
  modelId: string | null
  thinkingLevel: string | null
  toolNames: string[] | null
  skillIds: string[]
  workspaceMode: HarnessAgentWorkspaceMode
  isReviewer: boolean
  createdAt: number
  updatedAt: number
}

/** A concrete agent instance bound to one orchestration run. */
export interface HarnessAgent {
  id: string
  orchestrationId: string | null
  templateId: string | null
  name: string
  role: string
  description: string | null
  status: HarnessAgentStatus
  provider: string | null
  modelId: string | null
  thinkingLevel: string | null
  systemPrompt: string | null
  toolNames: string[] | null
  skillIds: string[]
  isReviewer: boolean
  /** Per-agent budget ceiling (cost / tokens); null = unlimited. */
  budget: HarnessAgentBudget
  /** Live Pi session backing this agent (real runs, never mocked). */
  sessionId: string | null
  cwd: string | null
  workspaceMode: HarnessAgentWorkspaceMode
  worktreePath: string | null
  worktreeBranch: string | null
  currentTaskId: string | null
  currentRunId: string | null
  createdAt: number
  updatedAt: number
}

export type HarnessTaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'verifying'
  | 'review'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type HarnessTaskPriority = 'low' | 'normal' | 'high' | 'critical'

export interface HarnessTask {
  id: string
  orchestrationId: string | null
  projectId: string | null
  title: string
  description: string | null
  status: HarnessTaskStatus
  priority: HarnessTaskPriority
  assignedAgentId: string | null
  parentTaskId: string | null
  /** Task ids that must complete before this task can be ready. */
  dependencies: string[]
  /** Explicit artifact ids this task should receive as input context. */
  inputArtifactIds: string[]
  runIds: string[]
  artifactIds: string[]
  /** Latest run that determined the current status. */
  lastRunId: string | null
  retryCount: number
  /** Gate this task through a reviewer agent before completing. */
  reviewRequired: boolean
  reviewAgentId: string | null
  reviewVerdict: 'approved' | 'rejected' | null
  reviewSummary: string | null
  error: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

export type HarnessOrchestrationStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'aborted'

export type HarnessOrchestrationStrategy = 'manual' | 'sequential' | 'dependency'

export interface HarnessOrchestrationBudget {
  maxCost: number | null
  maxTokens: number | null
}

/** Per-agent budget ceiling — enforced before each dispatch. */
export type HarnessAgentBudget = HarnessOrchestrationBudget

export interface HarnessOrchestrationRun {
  id: string
  name: string | null
  status: HarnessOrchestrationStatus
  strategy: HarnessOrchestrationStrategy
  cwd: string | null
  taskIds: string[]
  agentIds: string[]
  /** Concurrency ceilings — never unbounded parallelism by default. */
  maxConcurrentAgents: number
  maxConcurrentRuns: number
  budget: HarnessOrchestrationBudget
  startedAt: number | null
  finishedAt: number | null
  totalTokens: number
  estimatedCost: number | null
  successCount: number
  failureCount: number
  /** Set when a budget ceiling paused the orchestration. */
  pausedReason: string | null
  createdAt: number
  updatedAt: number
}

export interface AgentHandoff {
  id: string
  orchestrationId: string | null
  fromAgentId: string
  toAgentId: string
  taskId: string | null
  artifactIds: string[]
  summary: string | null
  createdAt: number
}

export interface HarnessTeam {
  id: string
  name: string
  description: string | null
  agentTemplateIds: string[]
  createdAt: number
  updatedAt: number
}

/** Files modified by more than one agent — merge risk, surfaced not auto-resolved. */
export interface HarnessConflictFile {
  path: string
  agentIds: string[]
  taskIds: string[]
}

export interface HarnessConflictReport {
  orchestrationId: string
  detectedAt: number
  conflicts: HarnessConflictFile[]
}

/** Per-agent cost / token rollup for an orchestration. */
export interface HarnessAgentCostShare {
  agentId: string
  name: string
  role: string
  runCount: number
  totalTokens: number
  estimatedCost: number | null
  toolCalls: number
  failures: number
  /** Share of total orchestration cost, 0–100, when cost is known. */
  costPercent: number | null
}

/** Deterministic final evaluation of a whole orchestration. */
export interface HarnessOrchestrationEvaluation {
  orchestrationId: string
  evaluatedAt: number
  status: 'passed' | 'warning' | 'failed'
  tasksCompleted: number
  tasksTotal: number
  tasksFailed: number
  runsSucceeded: number
  runsFailed: number
  policyViolations: number
  criticalFailures: number
  checks: HarnessEvaluationCheck[]
}

/** Pluggable task decomposition seam (ManualPlanner today, AI Planner later). */
export interface TaskPlanner {
  plan(input: HarnessPlannerInput): Promise<HarnessTask[]>
}

export interface HarnessPlannerInput {
  goal: string
  cwd: string | null
}

/** Agent with derived execution facts for the orchestration dashboard. */
export interface HarnessAgentSnapshot {
  agent: HarnessAgent
  runCount: number
  totalTokens: number
  estimatedCost: number | null
  toolCalls: number
  failures: number
  /** Milliseconds since the agent's run last produced an event, when running. */
  lastEventAt: number | null
  possiblyStuck: boolean
}

export interface HarnessOrchestrationSnapshot {
  orchestration: HarnessOrchestrationRun
  agents: HarnessAgentSnapshot[]
  tasks: HarnessTask[]
  handoffs: AgentHandoff[]
  conflicts: HarnessConflictReport | null
  costShares: HarnessAgentCostShare[]
  evaluation: HarnessOrchestrationEvaluation | null
  timeline: HarnessEvent[]
  budgetExceeded: boolean
}

// ---------------------------------------------------------------------------
// Data retention settings for persisted Harness stores.
// ---------------------------------------------------------------------------

export type HarnessRetentionDays = 7 | 30 | 90 | 0

export interface HarnessStoreSettings {
  schemaVersion: 1
  /** Days to keep persisted runs/traces/artifacts. `0` keeps them forever. */
  retentionDays: HarnessRetentionDays
  /** Replay events kept per run. */
  maxEventsPerRun: number
}

export interface HarnessExportResult {
  format: 'json' | 'markdown'
  path: string
  cancelled: boolean
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
  | (HarnessEventBase & {
      type: 'run.forked'
      runId: string
      newSessionId: string
      newRunId?: string
    })
  | (HarnessEventBase & {
      type: 'artifact.recorded'
      runId: string
      artifactId: string
      artifactType: string
    })
  | (HarnessEventBase & {
      type: 'baseline.changed'
      runId: string
      cwd: string
    })
  | (HarnessEventBase & {
      type: 'orchestration.started' | 'orchestration.paused'
      orchestrationId: string
      reason?: string
    })
  | (HarnessEventBase & {
      type: 'orchestration.completed' | 'orchestration.failed' | 'orchestration.aborted'
      orchestrationId: string
    })
  | (HarnessEventBase & {
      type: 'agent.created' | 'agent.deleted'
      agentId: string
      name: string
    })
  | (HarnessEventBase & {
      type: 'agent.assigned'
      agentId: string
      taskId: string
    })
  | (HarnessEventBase & {
      type: 'agent.started'
      agentId: string
      taskId: string
      runId: string
    })
  | (HarnessEventBase & {
      type: 'agent.waiting'
      agentId: string
      taskId: string
      reason?: string
    })
  | (HarnessEventBase & {
      type: 'agent.completed' | 'agent.failed'
      agentId: string
      taskId: string
      runId?: string
    })
  | (HarnessEventBase & {
      type: 'task.created'
      taskId: string
      title: string
    })
  | (HarnessEventBase & {
      type: 'task.ready'
      taskId: string
    })
  | (HarnessEventBase & {
      type: 'task.started'
      taskId: string
      agentId: string
      runId: string
    })
  | (HarnessEventBase & {
      type: 'task.blocked'
      taskId: string
      reason?: string
    })
  | (HarnessEventBase & {
      type: 'task.completed' | 'task.failed'
      taskId: string
      error?: string
    })
  | (HarnessEventBase & { type: 'task.cancelled'; taskId: string })
  | (HarnessEventBase & {
      type: 'handoff.created'
      handoffId: string
      fromAgentId: string
      toAgentId: string
    })
  | (HarnessEventBase & {
      type: 'review.started'
      taskId: string
      agentId: string
    })
  | (HarnessEventBase & {
      type: 'review.approved' | 'review.rejected'
      taskId: string
      agentId: string
    })

export interface HarnessEventEnvelope {
  sessionId: string
  event: HarnessEvent
}
