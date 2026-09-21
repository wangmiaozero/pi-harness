/**
 * Agent event batching.
 *
 * Ports `src/main/agent/agent-event-batcher.ts`: coalesce per-session
 * `{sessionId, event}` envelopes on a 16ms tick so one streamed token does
 * not become one JSONL line. Envelope order per session is preserved.
 */

export const AGENT_EVENT_BATCH_MS = 16

export type AgentEventEnvelope = { sessionId: string; event: Record<string, unknown> }
export type AgentEventBatch = AgentEventEnvelope | AgentEventEnvelope[]

export class AgentEventBatcher {
  private queue: AgentEventEnvelope[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(
    private readonly sink: (batch: AgentEventBatch) => void,
    private readonly intervalMs: number = AGENT_EVENT_BATCH_MS
  ) {}

  push(envelope: AgentEventEnvelope): void {
    if (this.closed) return
    this.queue.push(envelope)
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.intervalMs)
    // Do not keep the sidecar alive purely for pending batches.
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.queue.length === 0) return
    const batch = this.queue
    this.queue = []
    const payload: AgentEventBatch = batch.length === 1 ? batch[0]! : batch
    try {
      this.sink(payload)
    } catch {
      /* a failed write must not kill the batch loop */
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.flush()
  }
}
