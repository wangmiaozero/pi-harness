import { z } from 'zod'

export const SESSION_PARSER_REVISION = 6
const text = z.string()
const digest = text.regex(/^[a-f0-9]{64}$/)
export const recordEvidenceSchema = z.object({
  sourceRef: text,
  recordDigest: digest,
  representation: z.literal('parsed-record'),
  redacted: z.literal(true),
  truncated: z.boolean(),
  record: text
})
export type RecordEvidence = z.infer<typeof recordEvidenceSchema>
export const messageProvenanceSchema = z.object({
  parserRevision: z.literal(SESSION_PARSER_REVISION),
  recordDigest: digest,
  sourceRef: text,
  representation: z.literal('parsed-record'),
  trust: z.literal('untrusted-history')
})
export const toolInvocationSchema = z.object({
  callId: text,
  name: text,
  partIndex: z.number().int().nonnegative(),
  status: z.enum(['result-recorded', 'error-recorded', 'unknown']),
  resultEvidence: z.array(text),
  origin: z.literal('rule-derived')
})
export const historicalFileChangeSchema = z.object({
  path: text,
  kind: z.enum(['write', 'edit', 'delete']),
  status: z.enum(['requested', 'result-recorded', 'error-recorded']),
  evidence: z.array(text),
  diff: text.nullable(),
  diffTruncated: z.boolean().optional(),
  origin: z.literal('rule-derived'),
  currentVerified: z.literal(false)
})
const claim = z.object({ text, evidence: z.array(text), verification: text, confidence: text })
export const sessionNormalizationSchema = z.object({
  schemaVersion: z.literal(1),
  parserRevision: z.literal(SESSION_PARSER_REVISION),
  capabilities: z.record(
    z.enum([
      'messages',
      'tools',
      'reasoning',
      'fileChanges',
      'gitContext',
      'taskState',
      'artifacts',
      'usage'
    ]),
    z.enum(['extracted', 'derived', 'unknown', 'unsupported'])
  ),
  taskState: z.object({
    origin: z.literal('rule-derived'),
    currentVerified: z.literal(false),
    analyzedMessages: z.number().int().nonnegative(),
    totalMessages: z.number().int().nonnegative(),
    partial: z.boolean(),
    goal: claim,
    completed: z.array(claim),
    remaining: z.array(claim),
    blockers: z.array(claim),
    nextSteps: z.array(claim)
  }),
  gitContext: z.object({
    branch: text.nullable(),
    commit: text.nullable(),
    worktree: text.nullable()
  }),
  artifacts: z
    .array(z.object({ path: text, evidence: text, origin: z.literal('source-recorded') }))
    .max(200),
  evidence: z.object({
    records: z.number().int().nonnegative(),
    retained: z.number().int().nonnegative(),
    truncated: z.number().int().nonnegative(),
    representation: z.literal('redacted-parsed-records'),
    originalSourceReadOnly: z.literal(true)
  }),
  diagnostics: z.array(text)
})
export type SessionNormalization = z.infer<typeof sessionNormalizationSchema>

/** Missing metadata identifies a legacy v1 cache; rescan originals to enrich it. */
export function migrateSessionNormalization(value: unknown): SessionNormalization | null {
  return value === undefined || value === null ? null : sessionNormalizationSchema.parse(value)
}
