/**
 * Coalesce agent events before they cross the Electron IPC boundary.
 *
 * Streaming emits message deltas at very high frequency; sending one IPC
 * message per delta forces a renderer task (and a Vue render) per token,
 * which saturates the main thread and makes the UI feel sluggish — most
 * visibly on Windows. Events are buffered for one frame (~16ms) and
 * delivered in order. A single pending event keeps the historical
 * single-envelope payload so existing listeners keep working unchanged.
 */

export interface AgentEventEnvelope {
  sessionId: string
  event: unknown
}

export type AgentEventBatch = AgentEventEnvelope | AgentEventEnvelope[]

export type AgentEventSink = (batch: AgentEventBatch) => void

export const AGENT_EVENT_BATCH_MS = 16

export class AgentEventBatcher {
  private queue: AgentEventEnvelope[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(
    private readonly sink: AgentEventSink,
    private readonly flushMs: number = AGENT_EVENT_BATCH_MS
  ) {}

  push(envelope: AgentEventEnvelope): void {
    if (this.disposed) return
    this.queue.push(envelope)
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.flushMs)
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.disposed || this.queue.length === 0) return
    const batch = this.queue
    this.queue = []
    this.sink(batch.length === 1 ? batch[0] : batch)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.queue = []
  }
}
