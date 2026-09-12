/**
 * Harness Trace Repository.
 *
 * Persistence seam for per-run traces (spans + replay events). Spans and
 * events are derived exclusively from the real HarnessEvent stream — the
 * repository never invents data.
 */

import type { JsonStore } from '../../services/storage'
import type { HarnessRunTrace } from '@shared/types/harness'

const MAX_TRACED_RUNS = 100

export interface TraceStoreRecord {
  schemaVersion: 1
  traces: HarnessRunTrace[]
}

export const EMPTY_TRACE_STORE: TraceStoreRecord = { schemaVersion: 1, traces: [] }

export interface TraceRepository {
  save(trace: HarnessRunTrace): Promise<void>
  get(runId: string): Promise<HarnessRunTrace | null>
  listRunIds(): Promise<string[]>
  prune(now: number, retentionDays: number): Promise<number>
}

export class JsonTraceRepository implements TraceRepository {
  constructor(private readonly store: JsonStore<TraceStoreRecord>) {}

  async save(trace: HarnessRunTrace): Promise<void> {
    const record = await this.store.read()
    const next = [trace, ...record.traces.filter((item) => item.runId !== trace.runId)].slice(
      0,
      MAX_TRACED_RUNS
    )
    await this.store.write({ schemaVersion: 1, traces: next })
  }

  async get(runId: string): Promise<HarnessRunTrace | null> {
    const record = await this.store.read()
    return record.traces.find((trace) => trace.runId === runId) ?? null
  }

  async listRunIds(): Promise<string[]> {
    const record = await this.store.read()
    return record.traces.map((trace) => trace.runId)
  }

  async prune(now: number, retentionDays: number): Promise<number> {
    if (retentionDays <= 0) return 0
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
    const record = await this.store.read()
    // Traces carry no startedAt of their own; prune against the newest event.
    const kept = record.traces.filter((trace) => {
      const last = trace.events[trace.events.length - 1]
      const stamp = last?.event.timestamp ?? 0
      return stamp >= cutoff
    })
    if (kept.length === record.traces.length) return 0
    await this.store.write({ schemaVersion: 1, traces: kept })
    return record.traces.length - kept.length
  }
}
