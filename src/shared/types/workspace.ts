/**
 * Agent Workspace domain types.
 *
 * Session files stay in Pi's native JSONL format under ~/.pi/agent/sessions/.
 * These types describe the IPC/UI view of that data — they are not a new
 * on-disk format.
 */

export type { ToolPreset, ToolEntry } from '../workspace/tool-presets'

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
  source: {
    type: 'base64' | 'url'
    media_type?: string
    data?: string
    url?: string
  }
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

export interface ProjectInfo {
  projectRoot: string
  branch: string | null
  isWorktree: boolean
  isTopLevel: boolean
}

export interface SessionProjectGroup {
  projectKey: string
  projectRoot: string
  name: string
  sessions: SessionInfo[]
}

export interface SessionForkNode {
  session: SessionInfo
  children: SessionForkNode[]
}

export interface BranchSiblings {
  ids: string[]
  index: number
}

export interface WorktreeInfo {
  path: string
  branch: string | null
  isMain: boolean
}

export type GitFileStatusKind =
  'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

export interface GitFileStatus {
  filePath: string
  status: GitFileStatusKind
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
}

export interface GitFileDiffResponse {
  supported: boolean
  status?: GitFileStatusKind
  patch?: string
}

export interface FileTreeEntry {
  name: string
  path: string
  isDirectory: boolean
}

export type FilePreviewKind = 'text' | 'image' | 'audio' | 'pdf' | 'docx' | 'binary'

export interface FilePreview {
  kind: FilePreviewKind
  path: string
  name: string
  size: number
  language?: string
  mime?: string
  text?: string
  truncated?: boolean
  base64?: string
  revision?: string
}

export interface FileWriteResult {
  path: string
  size: number
  revision: string
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

export interface WorkspaceTab {
  id: string
  kind: 'chat' | 'file' | 'diff'
  title: string
  sessionId?: string
  filePath?: string
  closable: boolean
}

export type SessionContextAction =
  | 'pin'
  | 'unpin'
  | 'open'
  | 'rename'
  | 'archive'
  | 'fork'
  | 'export-html'
  | 'export-md'
  | 'reveal'
  | 'delete'
  | 'open-worktree'

export type ProjectContextAction =
  'pin' | 'unpin' | 'reveal' | 'remove' | 'archive-chats' | 'create-worktree'
