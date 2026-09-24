/**
 * Historical Replay.
 *
 * Replay is viewing what actually happened — never re-executing it. The
 * replay log comes from the recorded live trace when available, and otherwise
 * is reconstructed from the session JSONL entries Pi persisted. Every event
 * carries a real timestamp from one of those two sources.
 */

import type { SessionEntry } from '@shared/types/workspace'
import type {
  HarnessEvent,
  HarnessReplayEvent,
  HarnessRun,
  HarnessRunTrace,
  HarnessTraceSpan
} from '@shared/types/harness'
import { sliceRunEntries } from '../evaluation/evaluation-service'
import type { TraceService } from '../trace/trace-service'

const PREVIEW_LENGTH = 200

export interface ReplayHooks {
  getEntries: (sessionId: string) => Promise<SessionEntry[]>
}

export class ReplayService {
  constructor(
    private readonly trace: TraceService,
    private readonly hooks: ReplayHooks
  ) {}

  /** Replay log for a run: recorded trace first, session JSONL fallback. */
  async buildReplay(run: HarnessRun): Promise<HarnessRunTrace | null> {
    const recorded = await this.recordedTrace(run)
    if (recorded) return recorded
    return this.reconstructFromEntries(run)
  }

  private async recordedTrace(run: HarnessRun): Promise<HarnessRunTrace | null> {
    const live = this.trace.liveTrace(run.id)
    if (live) return live
    return this.trace.repository.get(run.id)
  }

  /** Reconstruct a replay log + spans from persisted session entries. */
  async reconstructFromEntries(run: HarnessRun): Promise<HarnessRunTrace | null> {
    let entries: SessionEntry[]
    try {
      entries = await this.hooks.getEntries(run.sessionId)
    } catch {
      return null
    }
    const runEntries = sliceRunEntries(entries, run)
    if (!runEntries.length) return null

    const events: HarnessReplayEvent[] = []
    const spans: HarnessTraceSpan[] = []
    let seq = 0
    /** toolCallId → toolName, remembered from assistant tool-call blocks. */
    const toolNames = new Map<string, string>()
    const push = (event: HarnessEvent, spanId: string | null = null): void => {
      events.push({ id: `ev-${seq++}`, index: events.length, spanId, event })
    }

    for (const entry of runEntries) {
      if (entry.type !== 'message') continue
      const timestamp = parseTimestamp(entry.timestamp) || run.startedAt
      const message = entry.message as
        | {
            role?: string
            content?: unknown
            model?: string
            provider?: string
            stopReason?: string
            usage?: {
              input?: number
              output?: number
              cacheRead?: number
              cacheWrite?: number
              total?: number
              cost?: { total?: number | null }
            }
            command?: string
            exitCode?: number
            cancelled?: boolean
            isError?: boolean
            errorMessage?: string
            toolCallId?: string
            toolName?: string
          }
        | undefined
      if (!message?.role) continue

      if (message.role === 'user') {
        push({ type: 'prompt.started', timestamp, message: previewFromContent(message.content) })
        continue
      }

      if (message.role === 'bashExecution') {
        if (typeof message.command !== 'string' || !message.command.trim()) continue
        const failed =
          typeof message.exitCode === 'number' &&
          message.exitCode !== 0 &&
          message.cancelled !== true
        const span: HarnessTraceSpan = {
          id: `span-h-${entry.id}`,
          runId: run.id,
          parentSpanId: null,
          type: 'shell',
          name: 'bash',
          status: failed ? 'failed' : message.cancelled === true ? 'skipped' : 'success',
          startedAt: timestamp,
          finishedAt: timestamp,
          duration: 0,
          metadata: { reconstructed: true, exitCode: message.exitCode ?? null },
          error: failed ? `exit ${message.exitCode}` : null,
          agentId: null
        }
        spans.push(span)
        push(
          {
            type: 'tool.completed',
            timestamp,
            toolName: 'bash',
            isError: failed
          },
          span.id
        )
        continue
      }

      if (message.role === 'assistant') {
        const blocks = Array.isArray(message.content) ? message.content : []
        const span: HarnessTraceSpan = {
          id: `span-h-${entry.id}`,
          runId: run.id,
          parentSpanId: null,
          type: 'model',
          name: 'model turn',
          status: message.stopReason === 'error' ? 'failed' : 'success',
          startedAt: timestamp,
          finishedAt: timestamp,
          duration: 0,
          metadata: {
            reconstructed: true,
            model: message.model ?? null,
            provider: message.provider ?? null
          },
          error:
            typeof message.errorMessage === 'string' && message.errorMessage
              ? message.errorMessage.slice(0, 200)
              : null,
          agentId: null
        }
        spans.push(span)
        push({ type: 'message.started', timestamp }, span.id)
        // Tool calls the assistant issued inside this turn.
        for (const block of blocks) {
          if (!block || typeof block !== 'object') continue
          const toolCall = block as { type?: string; toolCallId?: string; toolName?: string }
          if (toolCall.type !== 'toolCall' || !toolCall.toolName) continue
          if (toolCall.toolCallId) toolNames.set(toolCall.toolCallId, toolCall.toolName)
          push({ type: 'tool.started', timestamp, toolName: toolCall.toolName })
        }
        const usage = message.usage
        const completed: HarnessEvent = {
          type: 'message.completed',
          timestamp,
          ...(usage
            ? {
                usage: {
                  input: usage.input ?? 0,
                  output: usage.output ?? 0,
                  cacheRead: usage.cacheRead ?? 0,
                  cacheWrite: usage.cacheWrite ?? 0,
                  total:
                    usage.total ??
                    (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0),
                  cost: typeof usage.cost?.total === 'number' ? usage.cost.total : null
                }
              }
            : {}),
          ...(message.model ? { model: message.model } : {}),
          ...(message.provider ? { provider: message.provider } : {})
        }
        push(completed, span.id)
        continue
      }

      if (message.role === 'toolResult') {
        const toolName =
          (typeof message.toolName === 'string' && message.toolName) ||
          (typeof message.toolCallId === 'string'
            ? (toolNames.get(message.toolCallId) ?? null)
            : null) ||
          'tool'
        push({ type: 'tool.completed', timestamp, toolName, isError: message.isError === true })
      }
    }

    if (!events.length) return null
    return {
      runId: run.id,
      sessionId: run.sessionId,
      source: 'reconstructed',
      spans,
      events
    }
  }
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function previewFromContent(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, PREVIEW_LENGTH)
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: string }).type === 'text' &&
        typeof (block as { text?: string }).text === 'string'
      ) {
        parts.push((block as { text: string }).text)
      }
    }
    const text = parts.join('\n').trim()
    if (text) return text.slice(0, PREVIEW_LENGTH)
    return '[attachment]'
  }
  return ''
}
