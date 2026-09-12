/**
 * Harness Trace Service.
 *
 * Turns the unified HarnessEvent stream into APM-style spans and a replayable
 * event log, framed per run. Frames open on `run.started` and close on the
 * run verdict — the same reducer contract the RunRegistry uses. Nothing here
 * re-executes or fabricates events; span status is derived from what Pi
 * actually reported.
 */

import { randomUUID } from 'node:crypto'
import { log, redactSecrets } from '../../services/logger'
import type {
  HarnessEvent,
  HarnessReplayEvent,
  HarnessRun,
  HarnessRunTrace,
  HarnessTraceSpan,
  HarnessTraceSpanType
} from '@shared/types/harness'
import { type TraceRepository } from './trace-repository'

const DEFAULT_MAX_EVENTS_PER_RUN = 400
/** When capping, always keep the opening frames (run.started, prompt.started). */
const FRAME_HEAD_EVENTS = 3

const SHELL_TOOLS = new Set(['bash', 'shell', 'sh', 'zsh', 'terminal', 'execute', 'exec'])
const FILE_TOOLS = new Set(['read', 'write', 'edit', 'list', 'glob', 'ls', 'file', 'apply_patch'])
const GIT_TOOLS = new Set(['git', 'git_status', 'git_commit', 'git_diff', 'git_log'])
const NETWORK_TOOLS = new Set(['fetch', 'web', 'browser', 'http', 'request', 'search'])

interface RunTraceFrame {
  runId: string
  sessionId: string
  startedAt: number
  spans: HarnessTraceSpan[]
  events: HarnessReplayEvent[]
  openSpans: Map<string, HarnessTraceSpan>
  eventSeq: number
  closed: boolean
}

export interface TraceServiceOptions {
  repository?: TraceRepository
  maxEventsPerRun?: number
  /** Persist frames as runs settle (default true). */
  persist?: boolean
}

export class TraceService {
  readonly repository: TraceRepository
  private readonly frames = new Map<string, RunTraceFrame>()
  private readonly openFrameBySession = new Map<string, string>()

  constructor(private readonly options: TraceServiceOptions = {}) {
    this.repository = options.repository ?? new InMemoryTraceRepository()
  }

  /** Feed every emitted HarnessEvent (source + derived) into the trace frames. */
  observe(sessionId: string, event: HarnessEvent): void {
    try {
      this.reduce(sessionId, event)
    } catch (error) {
      log.harness.warn('trace service failed to reduce event:', error)
    }
  }

  /** Persist the recorded frame for a settled run. */
  async captureRun(run: HarnessRun): Promise<void> {
    const frame = this.frames.get(run.id)
    if (!frame) return
    frame.closed = true
    this.openFrameBySession.delete(frame.sessionId)
    for (const span of frame.spans) {
      if (span.status === 'running') {
        span.status = 'skipped'
        span.finishedAt = run.finishedAt ?? Date.now()
        span.duration = span.finishedAt - span.startedAt
      }
    }
    if (this.options.persist === false) return
    try {
      await this.repository.save(this.frameToTrace(frame))
    } catch (error) {
      log.harness.warn(`trace persistence failed for run ${run.id}:`, error)
    }
  }

  /** Recorded trace for a run, or null when nothing was captured live. */
  async getRecordedTrace(runId: string): Promise<HarnessRunTrace | null> {
    return this.repository.get(runId)
  }

  /** In-memory trace for an active run (used by live run detail). */
  liveTrace(runId: string): HarnessRunTrace | null {
    const frame = this.frames.get(runId)
    return frame ? this.frameToTrace(frame) : null
  }

  // ------------------------------------------------------------------ reducer

  private reduce(sessionId: string, event: HarnessEvent): void {
    if (event.type === 'run.started') {
      this.openFrame(sessionId, event.runId, event.timestamp)
      this.appendEvent(sessionId, event, null)
      return
    }
    if (
      event.type === 'run.completed' ||
      event.type === 'run.failed' ||
      event.type === 'run.aborted'
    ) {
      this.appendEvent(sessionId, event, null)
      this.closeFrame(sessionId, event.runId)
      return
    }

    const frame = this.frameFor(sessionId)
    if (!frame) return
    const spanId = this.reduceSpan(frame, event)
    this.appendEvent(sessionId, event, spanId)
  }

  private reduceSpan(frame: RunTraceFrame, event: HarnessEvent): string | null {
    switch (event.type) {
      case 'message.started': {
        const span = this.openSpan(frame, 'model', 'model turn', event.timestamp)
        return span.id
      }
      case 'message.completed': {
        const span = this.closeMatching(frame, 'model', 'model turn', event.timestamp, false, {
          usage: event.usage ?? null,
          model: event.model ?? null,
          provider: event.provider ?? null
        })
        return span?.id ?? null
      }
      case 'tool.started': {
        const toolName = event.toolName
        const span = this.openSpan(frame, classifyTool(toolName), toolName, event.timestamp, {
          toolCallId: event.toolCallId ?? null
        })
        return span.id
      }
      case 'tool.completed': {
        const span = this.closeToolSpan(frame, event)
        return span?.id ?? null
      }
      case 'compaction.started': {
        const span = this.openSpan(frame, 'compaction', 'compaction', event.timestamp, {
          automatic: event.automatic
        })
        return span.id
      }
      case 'compaction.completed': {
        const span = this.closeMatching(frame, 'compaction', 'compaction', event.timestamp, event.aborted === true, {
          aborted: event.aborted ?? false
        })
        return span?.id ?? null
      }
      case 'checkpoint.created': {
        const span = this.pointSpan(frame, 'checkpoint', `checkpoint (${event.reason})`, event.timestamp, {
          checkpointId: event.checkpointId
        })
        return span.id
      }
      case 'recovery.started': {
        const span = this.openSpan(frame, 'recovery', `recovery (${event.kind})`, event.timestamp, {
          kind: event.kind
        })
        return span.id
      }
      case 'recovery.completed': {
        const span = this.closeMatching(frame, 'recovery', 'recovery', event.timestamp, false, {
          kind: event.kind
        })
        return span?.id ?? null
      }
      case 'evaluation.started': {
        const span = this.openSpan(frame, 'evaluation', 'evaluation', event.timestamp)
        return span.id
      }
      case 'evaluation.completed': {
        const span = this.closeMatching(frame, 'evaluation', 'evaluation', event.timestamp, event.status === 'failed', {
          status: event.status
        })
        return span?.id ?? null
      }
      case 'runtime.error': {
        // Attribute the error to the newest open span when possible.
        const open = [...frame.openSpans.values()].at(-1)
        if (open) open.error = redactText(event.message)
        return null
      }
      default:
        return null
    }
  }

  private openFrame(sessionId: string, runId: string, timestamp: number): void {
    if (this.frames.has(runId)) return
    const frame: RunTraceFrame = {
      runId,
      sessionId,
      startedAt: timestamp,
      spans: [],
      events: [],
      openSpans: new Map(),
      eventSeq: 0,
      closed: false
    }
    this.frames.set(runId, frame)
    this.openFrameBySession.set(sessionId, runId)
    // A new run supersedes any still-open frame for the session.
    for (const [id, other] of this.frames) {
      if (id !== runId && other.sessionId === sessionId && !other.closed) other.closed = true
    }
  }

  private closeFrame(sessionId: string, runId: string): void {
    const frame = this.frames.get(runId)
    if (frame) frame.closed = true
    if (this.openFrameBySession.get(sessionId) === runId) this.openFrameBySession.delete(sessionId)
  }

  private frameFor(sessionId: string): RunTraceFrame | null {
    const runId = this.openFrameBySession.get(sessionId)
    if (!runId) return null
    const frame = this.frames.get(runId)
    if (!frame || frame.closed) return null
    return frame
  }

  private openSpan(
    frame: RunTraceFrame,
    type: HarnessTraceSpanType,
    name: string,
    startedAt: number,
    metadata: Record<string, unknown> = {}
  ): HarnessTraceSpan {
    const span: HarnessTraceSpan = {
      id: `span-${randomUUID()}`,
      runId: frame.runId,
      parentSpanId: null,
      type,
      name,
      status: 'running',
      startedAt,
      finishedAt: null,
      duration: null,
      metadata: redactSecrets(metadata) as Record<string, unknown>,
      error: null,
      agentId: null
    }
    frame.spans.push(span)
    frame.openSpans.set(span.id, span)
    return span
  }

  private pointSpan(
    frame: RunTraceFrame,
    type: HarnessTraceSpanType,
    name: string,
    timestamp: number,
    metadata: Record<string, unknown> = {}
  ): HarnessTraceSpan {
    const span: HarnessTraceSpan = {
      id: `span-${randomUUID()}`,
      runId: frame.runId,
      parentSpanId: null,
      type,
      name,
      status: 'success',
      startedAt: timestamp,
      finishedAt: timestamp,
      duration: 0,
      metadata: redactSecrets(metadata) as Record<string, unknown>,
      error: null,
      agentId: null
    }
    frame.spans.push(span)
    return span
  }

  private closeMatching(
    frame: RunTraceFrame,
    type: HarnessTraceSpanType,
    name: string,
    finishedAt: number,
    failed: boolean,
    metadata: Record<string, unknown> = {}
  ): HarnessTraceSpan | null {
    let span: HarnessTraceSpan | undefined
    for (let index = frame.spans.length - 1; index >= 0; index -= 1) {
      const candidate = frame.spans[index]
      if (candidate.type === type && candidate.status === 'running' && frame.openSpans.has(candidate.id)) {
        span = candidate
        break
      }
    }
    if (!span) return null
    return this.closeSpan(frame, span, finishedAt, failed ? 'failed' : 'success', metadata)
  }

  private closeToolSpan(
    frame: RunTraceFrame,
    event: Extract<HarnessEvent, { type: 'tool.started' | 'tool.completed' }>
  ): HarnessTraceSpan | null {
    const key = event.toolCallId ?? null
    let span: HarnessTraceSpan | undefined
    if (key) {
      for (let index = frame.spans.length - 1; index >= 0; index -= 1) {
        const candidate = frame.spans[index]
        if (
          candidate.status === 'running' &&
          frame.openSpans.has(candidate.id) &&
          candidate.metadata.toolCallId === key
        ) {
          span = candidate
          break
        }
      }
    }
    if (!span) {
      // Fall back to the oldest open span with the same tool name.
      span = frame.spans.find(
        (candidate) =>
          candidate.status === 'running' &&
          frame.openSpans.has(candidate.id) &&
          candidate.name === event.toolName
      )
    }
    if (!span) return null
    return this.closeSpan(frame, span, event.timestamp, event.isError ? 'failed' : 'success', {
      isError: event.isError === true
    })
  }

  private closeSpan(
    frame: RunTraceFrame,
    span: HarnessTraceSpan,
    finishedAt: number,
    status: HarnessTraceSpan['status'],
    metadata: Record<string, unknown> = {}
  ): HarnessTraceSpan {
    span.status = status
    span.finishedAt = finishedAt
    span.duration = Math.max(0, finishedAt - span.startedAt)
    span.metadata = {
      ...span.metadata,
      ...(redactSecrets(metadata) as Record<string, unknown>)
    }
    frame.openSpans.delete(span.id)
    return span
  }

  private appendEvent(sessionId: string, event: HarnessEvent, spanId: string | null): void {
    const runId =
      event.type === 'run.started'
        ? event.runId
        : event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.aborted'
          ? event.runId
          : this.openFrameBySession.get(sessionId)
    const frame = runId ? this.frames.get(runId) : null
    if (!frame) return
    frame.events.push({
      id: `ev-${frame.eventSeq++}`,
      index: frame.events.length,
      spanId,
      event: redactEvent(event)
    })
  }

  private frameToTrace(frame: RunTraceFrame): HarnessRunTrace {
    const max = this.maxEventsPerRun()
    let events = frame.events
    if (events.length > max) {
      // Keep the opening frames plus the newest tail so replay still shows
      // how the run started and how it ended.
      const tail = Math.max(0, max - FRAME_HEAD_EVENTS)
      events = [
        ...frame.events.slice(0, FRAME_HEAD_EVENTS),
        ...frame.events.slice(frame.events.length - tail)
      ].map((item, index) => ({ ...item, index }))
    }
    return {
      runId: frame.runId,
      sessionId: frame.sessionId,
      source: 'recorded',
      spans: frame.spans.map((span) => ({ ...span })),
      events
    }
  }

  private maxEventsPerRun(): number {
    const configured = this.options.maxEventsPerRun
    return typeof configured === 'number' && configured > 0 ? configured : DEFAULT_MAX_EVENTS_PER_RUN
  }
}

/** Classify a Pi tool name into a trace span type. */
export function classifyTool(toolName: string): HarnessTraceSpanType {
  const name = toolName.toLowerCase()
  if (SHELL_TOOLS.has(name)) return 'shell'
  if (FILE_TOOLS.has(name)) return 'file'
  if (GIT_TOOLS.has(name) || name.startsWith('git')) return 'git'
  if (NETWORK_TOOLS.has(name)) return 'network'
  return 'tool'
}

function redactEvent(event: HarnessEvent): HarnessEvent {
  return redactSecrets(event) as HarnessEvent
}

function redactText(value: string): string {
  return redactSecrets(value) as string
}

/** Non-persisting fallback so tests and headless runs stay usable. */
export class InMemoryTraceRepository implements TraceRepository {
  private readonly traces = new Map<string, HarnessRunTrace>()
  async save(trace: HarnessRunTrace): Promise<void> {
    this.traces.set(trace.runId, trace)
  }
  async get(runId: string): Promise<HarnessRunTrace | null> {
    return this.traces.get(runId) ?? null
  }
  async listRunIds(): Promise<string[]> {
    return [...this.traces.keys()]
  }
  async prune(): Promise<number> {
    return 0
  }
}
