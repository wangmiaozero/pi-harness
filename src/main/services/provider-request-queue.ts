import type { ProviderAdvancedSettings } from '@shared/providers/advanced-settings'

interface WaitingRequest {
  start: () => void
  stop: (error: unknown) => void
}

export class ProviderQueueError extends Error {}

export class AccountRequestQueue {
  private readonly active = new Map<string, number>()
  private readonly waiting: (WaitingRequest & { id: string })[] = []
  private limit = 20

  async acquire(
    id: string,
    settings: { maxAccounts: number; queueLimit?: number; queueWaitSeconds?: number },
    signal: AbortSignal
  ): Promise<() => void> {
    signal.throwIfAborted()
    this.limit = settings.maxAccounts
    const take = () => {
      this.active.set(id, (this.active.get(id) ?? 0) + 1)
      let finished = false
      return () => {
        if (finished) return
        finished = true
        const count = this.active.get(id) ?? 0
        if (count <= 1) this.active.delete(id)
        else this.active.set(id, count - 1)
        this.drain()
      }
    }
    if (this.active.has(id) || this.active.size < this.limit) return take()
    if (this.waiting.length >= (settings.queueLimit ?? Infinity))
      throw new ProviderQueueError('The account queue is full')
    return new Promise((resolve, reject) => {
      const remove = () => {
        const index = this.waiting.indexOf(item)
        if (index >= 0) this.waiting.splice(index, 1)
        clearTimeout(deadline)
        signal.removeEventListener('abort', abort)
      }
      const item = {
        id,
        start: () => {
          remove()
          resolve(take())
        },
        stop: (error: unknown) => {
          remove()
          reject(error)
        }
      }
      const abort = () => item.stop(signal.reason)
      const deadline = settings.queueWaitSeconds
        ? setTimeout(
            () => item.stop(new ProviderQueueError('Timed out waiting for an account slot')),
            settings.queueWaitSeconds * 1000
          )
        : undefined
      signal.addEventListener('abort', abort, { once: true })
      this.waiting.push(item)
    })
  }

  private drain() {
    for (const item of [...this.waiting]) {
      if (this.active.has(item.id) || this.active.size < this.limit) item.start()
    }
  }
}

export function releaseOnResponseClose(
  response: Response,
  release: () => void,
  signal: AbortSignal
): Response {
  const done = () => {
    signal.removeEventListener('abort', done)
    release()
  }
  if (!response.body) {
    done()
    return response
  }
  if (signal.aborted) done()
  else signal.addEventListener('abort', done, { once: true })
  const reader = response.body.getReader()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          controller.close()
          done()
        } else controller.enqueue(next.value)
      } catch (error) {
        done()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        done()
      }
    }
  })
  return new Response(stream, { status: response.status, headers: response.headers })
}

export class ProviderRequestQueue {
  private active = 0
  private timestamps: number[] = []
  private waiting: WaitingRequest[] = []
  private timer?: ReturnType<typeof setTimeout>

  private limit?: ProviderAdvancedSettings

  async acquire(settings: ProviderAdvancedSettings, signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    this.limit = settings
    if (this.waiting.length && this.waiting.length >= (settings.queueLimit ?? Infinity))
      throw new ProviderQueueError('The provider request queue is full')
    return new Promise((resolve, reject) => {
      let deadline: ReturnType<typeof setTimeout> | undefined
      const abort = () => item.stop(signal.reason)
      const cleanup = () => {
        clearTimeout(deadline)
        signal.removeEventListener('abort', abort)
        this.waiting = this.waiting.filter((entry) => entry !== item)
      }
      const item: WaitingRequest = {
        start: () => {
          cleanup()
          this.active++
          if (this.limit?.requestsPerMinute) this.timestamps.push(Date.now())
          let released = false
          resolve(() => {
            if (released) return
            released = true
            this.active--
            this.drain()
          })
        },
        stop: (error) => {
          cleanup()
          reject(error)
          this.drain()
        }
      }
      this.waiting.push(item)
      this.drain()
      if (!this.waiting.includes(item)) return
      if (settings.queueLimit === 0) {
        item.stop(new ProviderQueueError('The provider request queue is full'))
        return
      }
      signal.addEventListener('abort', abort, { once: true })
      if (settings.queueWaitSeconds)
        deadline = setTimeout(
          () => item.stop(new ProviderQueueError('Timed out waiting for a provider slot')),
          settings.queueWaitSeconds * 1000
        )
    })
  }

  private drain(): void {
    clearTimeout(this.timer)
    this.timestamps = this.timestamps.filter((time) => time > Date.now() - 60_000)
    while (this.waiting.length && this.active < (this.limit?.concurrency ?? Infinity)) {
      if (this.timestamps.length >= (this.limit?.requestsPerMinute ?? Infinity)) {
        this.timer = setTimeout(() => this.drain(), this.timestamps[0] + 60_000 - Date.now())
        this.timer.unref()
        return
      }
      this.waiting[0].start()
    }
  }
}
