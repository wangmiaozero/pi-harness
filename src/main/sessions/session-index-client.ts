import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { PiSessionInfoLike } from '../agent/pi-sdk'

export interface SessionIndex {
  list(): Promise<PiSessionInfoLike[]>
  close(): Promise<void>
}

export type SessionIndexRequest = {
  requestId: number
  agentDir: string | undefined
}

export type SessionIndexResponse =
  { requestId: number; sessions: PiSessionInfoLike[] } | { requestId: number; error: string }

/** Read-only Native Pi metadata indexing. AgentSession remains in Main. */
export class SessionIndexClient implements SessionIndex {
  private worker: Worker | null = null
  private nextRequestId = 0
  private closed = false
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private pending = new Map<
    number,
    { resolve: (sessions: PiSessionInfoLike[]) => void; reject: (error: Error) => void }
  >()

  constructor(
    private readonly createWorker: () => Worker = () =>
      new Worker(path.join(__dirname, 'session-index-worker.js'))
  ) {}

  list(): Promise<PiSessionInfoLike[]> {
    if (this.closed) return Promise.reject(new Error('Session index is closed'))
    clearTimeout(this.idleTimer)
    return new Promise((resolve, reject) => {
      try {
        const worker = this.getWorker()
        const requestId = ++this.nextRequestId
        this.pending.set(requestId, { resolve, reject })
        worker.postMessage({
          requestId,
          agentDir: process.env.PI_CODING_AGENT_DIR
        } satisfies SessionIndexRequest)
      } catch (error) {
        this.fail(this.worker, error instanceof Error ? error : new Error(String(error)))
        reject(error)
      }
    })
  }

  async close(): Promise<void> {
    this.closed = true
    clearTimeout(this.idleTimer)
    const worker = this.worker
    this.fail(worker, new Error('Session index is closed'))
    await worker?.terminate()
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker
    const worker = this.createWorker()
    this.worker = worker
    worker.on('message', (response: SessionIndexResponse) => {
      if (this.worker !== worker) return
      const request = this.pending.get(response.requestId)
      if (!request) return
      this.pending.delete(response.requestId)
      if ('error' in response) request.reject(new Error(response.error))
      else request.resolve(response.sessions)
      if (!this.pending.size) {
        // Release the SDK heap between infrequent history refreshes.
        this.idleTimer = setTimeout(() => {
          if (this.worker !== worker || this.pending.size) return
          this.worker = null
          void worker.terminate()
        }, 30_000)
        this.idleTimer.unref?.()
      }
    })
    worker.once('error', (error) =>
      this.fail(worker, error instanceof Error ? error : new Error(String(error)))
    )
    worker.once('exit', (code) =>
      this.fail(worker, new Error(`Session index worker exited (${code})`))
    )
    worker.unref()
    return worker
  }

  private fail(worker: Worker | null, error: Error): void {
    if (this.worker !== worker) return
    clearTimeout(this.idleTimer)
    this.worker = null
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }
}
