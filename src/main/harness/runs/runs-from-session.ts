/**
 * Reconstruct Harness Runs from a Pi session JSONL.
 *
 * History runs are derived from real session entries — every token count,
 * tool call and failure comes from what Pi actually persisted. Runs created
 * before Pi-Harness was watching are therefore first-class Run List citizens.
 */

import type { SessionEntry } from '@shared/types/workspace'
import type { HarnessRun, HarnessRunUsage } from '@shared/types/harness'

export interface ReconstructedRun {
  run: HarnessRun
  /** Ordered entry ids belonging to this run (evaluation evidence). */
  entryIds: string[]
}

const PROMPT_PREVIEW_LENGTH = 200
const RESULT_PREVIEW_LENGTH = 400

const EMPTY_USAGE: HarnessRunUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  estimatedCost: 0
}

export function buildRunsFromEntries(entries: readonly SessionEntry[]): ReconstructedRun[] {
  const runs: ReconstructedRun[] = []
  let current: ReconstructedRun | null = null

  for (const entry of entries) {
    if (entry.type !== 'message') continue
    const message = entry.message as
      | {
          role?: string
          content?: unknown
          model?: string
          provider?: string
          stopReason?: string
          errorMessage?: string
          usage?: {
            input?: number
            output?: number
            cacheRead?: number
            cacheWrite?: number
            cost?: { total?: number }
          }
        }
      | undefined
    if (!message || typeof message.role !== 'string') continue
    const timestamp = parseTimestamp(entry.timestamp)

    if (message.role === 'user') {
      if (current) finalizeReconstructed(current, timestamp)
      current = {
        run: {
          id: `h:${entry.id}`,
          sessionId: '',
          parentRunId: null,
          relation: 'original',
          forkedFromRunId: null,
          forkedFromEventId: null,
          forkedFromCheckpointId: null,
          status: 'running',
          source: 'history',
          anchorEntryId: entry.id,
          cwd: null,
          agentId: null,
          taskId: null,
          orchestrationId: null,
          startedAt: timestamp,
          finishedAt: null,
          model: null,
          provider: null,
          prompt: previewFromContent(message.content, PROMPT_PREVIEW_LENGTH),
          usage: { ...EMPTY_USAGE },
          toolCallCount: 0,
          toolFailureCount: 0,
          contextUsage: null,
          result: null,
          error: null,
          budgetExceeded: null,
          steps: [],
          checkpointIds: []
        },
        entryIds: [entry.id]
      }
      runs.push(current)
      continue
    }

    if (!current) continue
    current.entryIds.push(entry.id)

    if (message.role === 'assistant') {
      if (typeof message.model === 'string' && message.model) current.run.model = message.model
      if (typeof message.provider === 'string' && message.provider)
        current.run.provider = message.provider
      const usage = message.usage
      if (usage) {
        const input = numberOrZero(usage.input)
        const output = numberOrZero(usage.output)
        const cached = numberOrZero(usage.cacheRead)
        current.run.usage.inputTokens += input
        current.run.usage.outputTokens += output
        current.run.usage.cachedTokens += cached
        current.run.usage.totalTokens += input + output + cached
        const cost = usage.cost?.total
        if (typeof cost === 'number' && Number.isFinite(cost)) {
          current.run.usage.estimatedCost = (current.run.usage.estimatedCost ?? 0) + cost
        }
      }
      const blocks = Array.isArray(message.content) ? message.content : []
      current.run.toolCallCount += blocks.filter(
        (block) =>
          block && typeof block === 'object' && (block as { type?: string }).type === 'toolCall'
      ).length
      const text = textFromBlocks(blocks)
      if (text) current.run.result = text.slice(0, RESULT_PREVIEW_LENGTH)
      const errorMessage = message.errorMessage
      if (typeof errorMessage === 'string' && errorMessage.trim()) {
        current.run.error = errorMessage.slice(0, 500)
      } else if (message.stopReason === 'error') {
        current.run.error = current.run.error ?? 'Assistant turn ended with an error'
      }
      continue
    }

    if (message.role === 'toolResult') {
      const toolResult = entry.message as { isError?: boolean } | undefined
      if (toolResult?.isError === true) current.run.toolFailureCount += 1
    }
  }

  if (current) finalizeReconstructed(current, null)
  return runs
}

function finalizeReconstructed(
  reconstructed: ReconstructedRun,
  nextTimestamp: number | null
): void {
  const run = reconstructed.run
  run.finishedAt = nextTimestamp
  run.status = run.error ? 'failed' : 'success'
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function previewFromContent(content: unknown, maxLength: number): string {
  if (typeof content === 'string') return content.slice(0, maxLength)
  if (Array.isArray(content)) {
    const text = textFromBlocks(content)
    if (text) return text.slice(0, maxLength)
    return '[attachment]'
  }
  return ''
}

function textFromBlocks(blocks: unknown[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'text' &&
      typeof (block as { text?: string }).text === 'string'
    ) {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.join('\n').trim()
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
