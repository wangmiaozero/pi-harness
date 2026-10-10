import { z } from 'zod'
import { workspacePathSchema } from '../schemas/workspace'

export const SOURCE_PROVIDERS = [
  'claude',
  'codex',
  'cursor',
  'cursor-agent',
  'gemini',
  'opencode',
  'pi'
] as const
export const sourceProviderSchema = z.enum(SOURCE_PROVIDERS)
export type SourceProvider = z.infer<typeof sourceProviderSchema>
export const SOURCE_LABELS: Record<SourceProvider, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  'cursor-agent': 'Cursor Agent',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  pi: 'Pi'
}
const id = z.string().regex(/^[a-f0-9]{64}$/)
const text = z.string()
export const universalPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text }),
  z.object({ type: z.literal('thinking'), text }),
  z.object({ type: z.literal('tool-call'), callId: text, name: text, input: text }),
  z.object({ type: z.literal('tool-result'), callId: text, text, isError: z.boolean() }),
  z.object({ type: z.literal('code'), text, language: text.optional() }),
  // External references never grant file access or cause a remote image fetch.
  z.object({ type: z.literal('image-reference'), reference: text, mimeType: text.optional() }),
  z.object({ type: z.literal('file-reference'), path: text }),
  z.object({ type: z.literal('error'), text }),
  z.object({
    type: z.literal('usage'),
    input: z.number().nonnegative().optional(),
    output: z.number().nonnegative().optional(),
    cached: z.number().nonnegative().optional(),
    cacheWrite: z.number().nonnegative().optional(),
    reasoning: z.number().nonnegative().optional(),
    total: z.number().nonnegative().optional(),
    cost: z.number().nonnegative().optional()
  }),
  z.object({ type: z.literal('native-event'), eventType: text, text })
])
export type UniversalPart = z.infer<typeof universalPartSchema>
export const universalMessageSchema = z.object({
  id: text,
  sessionId: id,
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  timestamp: text.optional(),
  parts: z.array(universalPartSchema),
  nativeMessageId: text.optional(),
  sourceRef: text
})
export type UniversalMessage = z.infer<typeof universalMessageSchema>
export const universalSessionSchema = z.object({
  id,
  schemaVersion: z.literal(1),
  provider: sourceProviderSchema,
  nativeSessionId: text,
  title: text,
  projectPath: text.optional(),
  workspacePath: text.optional(),
  workspaceRoots: z.array(workspacePathSchema).min(1).max(32).optional(),
  createdAt: text,
  updatedAt: text,
  model: text.optional(),
  messageCount: z.number().int().nonnegative(),
  source: z.object({
    path: text,
    root: text,
    format: text,
    fingerprint: id,
    status: z.enum(['available', 'missing', 'error']),
    syncedAt: text
  }),
  metadata: z.object({
    tokens: z.number().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
    hasToolCalls: z.boolean()
  }),
  warnings: z.array(text),
  blob: id
})
export type UniversalSession = z.infer<typeof universalSessionSchema>
export const sourceLocationSchema = z.object({
  provider: sourceProviderSchema,
  root: text,
  custom: z.boolean()
})
export type SourceLocation = z.infer<typeof sourceLocationSchema>
export const syncStatusSchema = z.object({
  watchEnabled: z.boolean().optional(),
  running: z.boolean(),
  cancelled: z.boolean(),
  scanned: z.number(),
  changed: z.number(),
  errors: z.array(z.object({ provider: sourceProviderSchema, code: text })),
  lastSync: text.optional()
})
export type UniversalSyncStatus = z.infer<typeof syncStatusSchema>
export const universalQuerySchema = z
  .object({
    provider: sourceProviderSchema.optional(),
    projectPath: text.max(4096).optional(),
    query: text.max(500).optional(),
    after: z.string().datetime().optional(),
    before: z.string().datetime().optional(),
    offset: z.number().int().min(0).max(1_000_000).default(0),
    limit: z.number().int().min(1).max(200).default(100)
  })
  .strict()
export type UniversalQuery = z.input<typeof universalQuerySchema>
export const universalReadSchema = z
  .object({
    id,
    offset: z.number().int().min(0).max(1_000_000).default(0),
    limit: z.number().int().min(1).max(200).default(50)
  })
  .strict()
export const universalIdSchema = z.object({ id }).strict()
export const universalMapSchema = z
  .object({
    id,
    workspacePath: workspacePathSchema,
    workspaceRoots: z.array(workspacePathSchema).min(1).max(32).optional()
  })
  .strict()
export const universalWatchSchema = z.object({ enabled: z.boolean() }).strict()
export const universalProviderInputSchema = z.object({ provider: sourceProviderSchema }).strict()
export const handoffInputSchema = z
  .object({ id, instruction: text.trim().min(1).max(8000) })
  .strict()
export const handoffClaimSchema = z.object({
  text: text.max(8000),
  evidence: z.array(text).max(50),
  confidence: z.enum(['low', 'medium', 'high']),
  verification: z.enum([
    'historical-claim',
    'historical-evidence',
    'current-verified',
    'unverified'
  ])
})
export type HandoffClaim = z.infer<typeof handoffClaimSchema>
const workspaceGitSchema = z.object({
  recordedCommit: text.optional(),
  currentCommit: text.optional(),
  hasChanges: z.boolean().optional(),
  status: text,
  repositoryRoot: text.optional(),
  stateFingerprint: text.optional()
})
export const sessionHandoffSchema = z.object({
  id,
  schemaVersion: z.literal(1),
  sourceSessionId: id,
  sourceProvider: sourceProviderSchema,
  sourceFingerprint: id,
  workspacePath: text,
  workspaces: z
    .array(z.object({ path: workspacePathSchema, git: workspaceGitSchema }))
    .min(1)
    .max(32)
    .optional(),
  createdAt: text,
  instruction: text,
  goal: handoffClaimSchema,
  completed: z.array(handoffClaimSchema),
  remaining: z.array(handoffClaimSchema),
  decisions: z.array(handoffClaimSchema),
  constraints: z.array(handoffClaimSchema),
  unresolvedIssues: z.array(handoffClaimSchema),
  relevantFiles: z.array(
    z.object({
      path: text,
      workspacePath: text.optional(),
      exists: z.boolean(),
      evidence: text,
      revision: text.optional()
    })
  ),
  git: workspaceGitSchema,
  verification: z.object({
    contextVerified: z.boolean(),
    filesVerified: z.boolean(),
    testsVerified: z.literal(false)
  }),
  context: text,
  omittedMessages: z.number().int().nonnegative(),
  piSessionId: text.optional()
})
export type SessionHandoff = z.infer<typeof sessionHandoffSchema>
export const universalIndexSchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(sourceLocationSchema),
  sessions: z.array(universalSessionSchema),
  watch: z.boolean(),
  status: syncStatusSchema
})
export type UniversalIndex = z.infer<typeof universalIndexSchema>

export interface UniversalSessionsAPI {
  origin(piSessionId: string): Promise<SessionHandoff | null>
  list(
    input?: UniversalQuery
  ): Promise<{ sessions: UniversalSession[]; total: number; projects: string[] }>
  read(
    input: z.input<typeof universalReadSchema>
  ): Promise<{ session: UniversalSession; messages: UniversalMessage[]; total: number }>
  sources(): Promise<SourceLocation[]>
  addSource(provider: SourceProvider): Promise<SourceLocation | null>
  sync(): Promise<UniversalSyncStatus>
  cancelSync(): Promise<void>
  status(): Promise<UniversalSyncStatus>
  setWatch(enabled: boolean): Promise<void>
  map(id: string, workspacePath: string, workspaceRoots?: string[]): Promise<UniversalSession>
  clear(): Promise<void>
  forget(id: string): Promise<void>
  preview(id: string, instruction: string): Promise<SessionHandoff>
  continue(handoffId: string): Promise<{ sessionId: string; handoff: SessionHandoff }>
}
