import { createHash } from 'node:crypto'
import {
  sessionNormalizationSchema,
  type RecordEvidence,
  type SessionNormalization
} from '@shared/universal/evidence-schema'
import type { UniversalMessage } from '@shared/universal/schema'
import { extractClaims } from './handoff-claims'
import { object, redact, serialized, string } from './normalize'

export const recordDigest = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(value) ?? 'null')
    .digest('hex')

/** Bounded, redacted evidence snapshot; never label it as a byte-for-byte original. */
export function retainRecordEvidence(
  records: unknown[],
  file: string,
  recordNumbers?: number[],
  sensitiveRecords = new Set<string>()
): RecordEvidence[] {
  let budget = 16 * 1024 * 1024
  const evidence: RecordEvidence[] = []
  for (let index = 0; index < records.length; index++) {
    if (budget < 1024) break
    const sourceRef = `${file}#record=${recordNumbers?.[index] ?? index + 1}`
    const value = sensitiveRecords.has(sourceRef)
      ? '[REDACTED SENSITIVE TOOL OUTPUT RECORD]'
      : serialized(records[index])
    const excerpt = value.slice(0, Math.min(32_000, Math.floor((budget - 1024) / 4)))
    const record: RecordEvidence = {
      sourceRef,
      recordDigest: recordDigest(records[index]),
      representation: 'parsed-record',
      redacted: true,
      truncated: excerpt.length !== value.length,
      record: excerpt
    }
    budget -= Buffer.byteLength(JSON.stringify(record)) + 1
    evidence.push(record)
  }
  return evidence
}

/** Correlate only unique recorded call IDs. A returned result is not proof of a current file change. */
export function normalizeSessionEvidence(
  messages: UniversalMessage[],
  records: unknown[],
  evidence: RecordEvidence[]
): SessionNormalization {
  const calls = new Map<string, number>()
  const recordedDiffs = new Map<string, Set<string>>()
  for (const record of records) {
    const message = object(object(record).message)
    const diff = object(message.details).diff
    if (
      message.role !== 'toolResult' ||
      typeof message.toolCallId !== 'string' ||
      typeof diff !== 'string'
    )
      continue
    if (!recordedDiffs.has(message.toolCallId)) recordedDiffs.set(message.toolCallId, new Set())
    recordedDiffs.get(message.toolCallId)!.add(diff)
  }
  const results = new Map<string, Array<{ reference: string; error: boolean }>>()
  const artifacts: SessionNormalization['artifacts'] = []
  let artifactReferences = 0
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool-call' && part.callId)
        calls.set(part.callId, (calls.get(part.callId) ?? 0) + 1)
      if (part.type === 'tool-result' && part.callId)
        results.set(part.callId, [
          ...(results.get(part.callId) ?? []),
          { reference: message.sourceRef, error: part.isError }
        ])
      if (part.type === 'file-reference') {
        artifactReferences++
        if (artifacts.length < 200)
          artifacts.push({
            path: part.path,
            evidence: message.sourceRef,
            origin: 'source-recorded'
          })
      }
    }
  }
  const diagnostics: string[] = []
  if (artifactReferences > artifacts.length) diagnostics.push('ARTIFACT_REFERENCE_LIMIT')
  for (const message of messages) {
    message.toolInvocations = []
    message.fileChanges = []
    message.parts.forEach((part, partIndex) => {
      if (part.type !== 'tool-call') return
      const unique = !!part.callId && calls.get(part.callId) === 1
      const outcome = unique ? (results.get(part.callId) ?? []) : []
      const status = outcome.some((result) => result.error)
        ? 'error-recorded'
        : outcome.length
          ? 'result-recorded'
          : 'unknown'
      message.toolInvocations!.push({
        callId: part.callId,
        name: part.name,
        partIndex,
        status,
        resultEvidence: outcome.map((result) => result.reference),
        origin: 'rule-derived'
      })
      if (!unique) diagnostics.push('AMBIGUOUS_OR_MISSING_CALL_ID')
      const kind = /^(?:write|write_file|Write)$/.test(part.name)
        ? 'write'
        : /^(?:edit|edit_file|Edit)$/.test(part.name)
          ? 'edit'
          : /^(?:delete_file|DeleteFile)$/.test(part.name)
            ? 'delete'
            : null
      if (!kind) return
      try {
        const input = object(JSON.parse(part.input))
        const file = string(input.path ?? input.file_path ?? input.filePath ?? input.filename)
        if (!file) return
        const patch = string(input.patch ?? input.diff)
        const results = recordedDiffs.get(part.callId)
        const candidate = patch ?? (unique && results?.size === 1 ? [...results][0] : undefined)
        const diff = candidate && /^(?:diff --git |@@)/m.test(candidate) ? candidate : null
        const diffTruncated = !!diff && diff.length > 16000
        if (diffTruncated) diagnostics.push('FILE_DIFF_TRUNCATED')
        message.fileChanges!.push({
          path: file,
          kind,
          status: status === 'unknown' ? 'requested' : status,
          evidence: [message.sourceRef, ...outcome.map((result) => result.reference)],
          diff: diff ? diff.slice(0, 16000) : null,
          diffTruncated,
          origin: 'rule-derived',
          currentVerified: false
        })
      } catch {
        diagnostics.push('UNPARSED_TOOL_ARGUMENTS')
      }
    })
  }
  const sampled =
    messages.length > 200 ? [...messages.slice(0, 100), ...messages.slice(-100)] : messages
  const extractedClaims = extractClaims(sampled)
  const claimsTruncated =
    extractedClaims.goal.text.length > 800 ||
    [extractedClaims.completed, extractedClaims.remaining, extractedClaims.unresolvedIssues].some(
      (claims) => claims.length > 8 || claims.some((claim) => claim.text.length > 800)
    )
  if (claimsTruncated) diagnostics.push('TASK_STATE_TRUNCATED')
  const boundedClaim = (claim: typeof extractedClaims.goal) => ({
    ...claim,
    text: claim.text.slice(0, 800),
    evidence: claim.evidence.slice(0, 10)
  })
  const claims = {
    goal: boundedClaim(extractedClaims.goal),
    completed: extractedClaims.completed.slice(-8).map(boundedClaim),
    remaining: extractedClaims.remaining.slice(-8).map(boundedClaim),
    unresolvedIssues: extractedClaims.unresolvedIssues.slice(-8).map(boundedClaim)
  }
  if (sampled.length < messages.length) diagnostics.push('TASK_STATE_SAMPLED')
  const gitContext: SessionNormalization['gitContext'] = {
    branch: null,
    commit: null,
    worktree: null
  }
  for (const raw of records) {
    const record = object(raw)
    // Only provider metadata is eligible; conversation prose cannot establish a Git revision.
    if (record.type !== 'session_meta' && record.type !== 'session') continue
    const git = object(object(record.payload).git ?? record.git)
    gitContext.branch = typeof git.branch === 'string' ? redact(git.branch) : gitContext.branch
    gitContext.commit =
      typeof (git.commit_hash ?? git.commit) === 'string'
        ? redact(String(git.commit_hash ?? git.commit))
        : gitContext.commit
    gitContext.worktree =
      typeof git.worktree === 'string' ? redact(git.worktree) : gitContext.worktree
  }
  const has = (type: UniversalMessage['parts'][number]['type']) =>
    messages.some((message) => message.parts.some((part) => part.type === type))
  const truncated = evidence.filter((record) => record.truncated).length
  if (truncated || evidence.length < records.length) diagnostics.push('EVIDENCE_RETENTION_LIMIT')
  return sessionNormalizationSchema.parse({
    schemaVersion: 1,
    parserRevision: 6,
    capabilities: {
      messages: messages.some((message) =>
        message.parts.some((part) => part.type !== 'native-event')
      )
        ? 'extracted'
        : 'unknown',
      tools: has('tool-call') || has('tool-result') ? 'extracted' : 'unknown',
      reasoning: has('thinking') ? 'extracted' : 'unknown',
      fileChanges: messages.some((message) => message.fileChanges!.length) ? 'derived' : 'unknown',
      gitContext: Object.values(gitContext).some(Boolean) ? 'extracted' : 'unknown',
      taskState:
        claims.goal.text ||
        claims.completed.length ||
        claims.remaining.length ||
        claims.unresolvedIssues.length
          ? 'derived'
          : 'unknown',
      artifacts: artifacts.length ? 'extracted' : 'unknown',
      usage: has('usage') ? 'extracted' : 'unknown'
    },
    taskState: {
      origin: 'rule-derived',
      currentVerified: false,
      analyzedMessages: sampled.length,
      totalMessages: messages.length,
      partial: sampled.length < messages.length || claimsTruncated,
      goal: claims.goal,
      completed: claims.completed,
      remaining: claims.remaining,
      blockers: claims.unresolvedIssues,
      nextSteps: claims.remaining
    },
    gitContext,
    artifacts,
    evidence: {
      records: records.length,
      retained: evidence.length,
      truncated,
      representation: 'redacted-parsed-records',
      originalSourceReadOnly: true
    },
    diagnostics: [...new Set(diagnostics)]
  })
}
