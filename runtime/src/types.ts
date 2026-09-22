/**
 * Runtime-local domain types.
 *
 * Mirrors the relevant subset of `src/shared/types/workspace.ts`. The runtime
 * package is self-contained (`rootDir: "src"`), so it cannot import
 * `src/shared` directly; these copies are deliberately kept in sync with the
 * shared module and must not drift (the JSONL payloads they describe are the
 * contract with the renderer).
 *
 * Only session/agent/harness types needed by the runtime live here — no
 * workspace, git, or file-tree types (later phases).
 */

export type { ToolPreset, ToolEntry } from './support/tool-presets.js'

export type AgentRuntimeStatus =
  'idle' | 'starting' | 'running' | 'compacting' | 'aborting' | 'error'

export interface SessionHeader {
  type: 'session'
  version?: number
  id: string
  timestamp: string
  cwd: string
  parentSession?: string
  [key: string]: unknown
}

export interface SessionEntryBase {
  type: string
  id: string
  parentId: string | null
  timestamp: string
}

export interface TextContent {
  type: 'text'
  text: string
}

export interface ImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export interface ThinkingContent {
  type: 'thinking'
  thinking: string
  deferred?: boolean
}

export interface ToolCallContent {
  type: 'toolCall'
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  rawInput?: string
}

export type AssistantContentBlock = TextContent | ImageContent | ThinkingContent | ToolCallContent

export interface UserMessage {
  role: 'user'
  content: string | (TextContent | ImageContent)[]
  timestamp?: number
}

export interface AssistantMessage {
  role: 'assistant'
  content: AssistantContentBlock[]
  model: string
  provider: string
  stopReason?: string
  errorMessage?: string
  timestamp?: number
  usage?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cost: {
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
      total: number
    }
  }
}

export interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName?: string
  content: (TextContent | ImageContent)[]
  isError?: boolean
  details?: unknown
  timestamp?: number
}

export interface CustomMessage {
  role: 'custom'
  customType: string
  content: string | (TextContent | ImageContent)[]
  display: boolean
  details?: unknown
  timestamp?: number
}

export interface BashExecutionMessage {
  role: 'bashExecution'
  command: string
  output: string
  exitCode?: number
  cancelled?: boolean
  truncated?: boolean
  fullOutputPath?: string
  excludeFromContext?: boolean
  timestamp?: number
}

export type AgentMessage =
  UserMessage | AssistantMessage | ToolResultMessage | CustomMessage | BashExecutionMessage

export interface SessionMessageEntry extends SessionEntryBase {
  type: 'message'
  message: AgentMessage
}

export interface CompactionEntry extends SessionEntryBase {
  type: 'compaction'
  summary: string
  firstKeptEntryId: string
  tokensBefore: number
  tokensAfter: number
  details?: unknown
  fromHook?: boolean
}

export interface BranchSummaryEntry extends SessionEntryBase {
  type: 'branch_summary'
  fromId: string
  summary: string
  details?: unknown
  fromHook?: boolean
}

export interface CustomMessageEntry extends SessionEntryBase {
  type: 'custom_message'
  customType: string
  content: string | (TextContent | ImageContent)[]
  details?: unknown
  display: boolean
}

export type SessionEntry = SessionEntryBase & Record<string, unknown>

export interface SessionInfo {
  path: string
  id: string
  cwd: string
  name?: string
  created: string
  modified: string
  messageCount: number
  firstMessage: string
  parentSessionId?: string
  projectRoot?: string
  projectKey?: string
  worktreeBranch?: string
  transient?: boolean
}

export interface SessionContext {
  messages: AgentMessage[]
  entryIds: string[]
  entryParents: Record<string, string | null>
  thinkingLevel: string
  model: { provider: string; modelId: string } | null
}

export interface SessionDetail {
  sessionId: string
  filePath: string
  info: SessionInfo | null
  leafId: string | null
  context: SessionContext
  /** Estimated active wall-clock time across the append-only session log. */
  totalActiveMs?: number
}

export interface SessionStats {
  sessionFile?: string
  sessionId: string
  sessionName?: string
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalMessages: number
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost: number
  totalActiveMs?: number
}

export interface AgentEvent {
  type: string
  [key: string]: unknown
}

export interface AgentStateSnapshot {
  sessionId: string
  sessionFile: string
  status: AgentRuntimeStatus
  isStreaming: boolean
  isPromptRunning: boolean
  isBashRunning: boolean
  isCompacting: boolean
  autoCompactionEnabled: boolean
  model?: { id: string; provider: string }
  thinkingLevel: string
  contextUsage: {
    percent: number | null
    contextWindow: number
    tokens: number | null
  } | null
  pendingMessageCount: number
  queuedMessages: { steering: string[]; followUp: string[] }
}

export interface AgentImageAttachment {
  type: 'image'
  data: string
  mimeType: string
}

export type GitFileStatusKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'unmerged' | 'copied'

export interface GitFileStatus {
  filePath: string
  status: GitFileStatusKind | string
  code: 'M' | 'A' | 'D' | 'R' | 'U' | 'C'
  indexStatus: string
  worktreeStatus: string
}

export interface GitStatusResponse {
  isGitRepository: boolean
  repositoryRoot: string | null
  files: GitFileStatus[]
  additions: number
  deletions: number
  folderId?: string
  folderName?: string
  branch?: string | null
}

export interface StartAgentSessionInput {
  sessionId?: string
  cwd?: string
  message?: string
  toolNames?: string[]
  provider?: string
  modelId?: string
  thinkingLevel?: string
}

export interface PromptAgentInput {
  sessionId: string
  message: string
  images?: AgentImageAttachment[]
  streamingBehavior?: 'steer' | 'followUp'
}
