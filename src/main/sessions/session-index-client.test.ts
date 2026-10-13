import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionIndexClient } from './session-index-client'

class FakeWorker extends EventEmitter {
  postMessage = vi.fn()
  unref = vi.fn()
  terminate = vi.fn().mockResolvedValue(0)
}

afterEach(() => vi.useRealTimers())

describe('SessionIndexClient', () => {
  it('starts lazily, correlates replies and preserves Native dates', async () => {
    const worker = new FakeWorker()
    const factory = vi.fn(() => worker as unknown as Worker)
    const index = new SessionIndexClient(factory)
    expect(factory).not.toHaveBeenCalled()
    const first = index.list()
    const second = index.list()
    expect(factory).toHaveBeenCalledTimes(1)
    const sessions = [{ id: 'native', created: new Date('2026-10-13T00:00:00Z') }]
    worker.emit('message', { requestId: 2, sessions })
    await expect(second).resolves.toEqual(sessions)
    worker.emit('message', { requestId: 1, sessions: [] })
    await expect(first).resolves.toEqual([])
    expect(worker.postMessage).toHaveBeenCalledWith({
      requestId: 1,
      agentDir: process.env.PI_CODING_AGENT_DIR
    })
    await index.close()
  })

  it('rejects crashes and ignores an old worker exiting after its replacement starts', async () => {
    const old = new FakeWorker()
    const replacement = new FakeWorker()
    const factory = vi
      .fn<() => Worker>()
      .mockReturnValueOnce(old as unknown as Worker)
      .mockReturnValueOnce(replacement as unknown as Worker)
    const index = new SessionIndexClient(factory)
    const failed = expect(index.list()).rejects.toThrow('worker crashed')
    old.emit('error', new Error('worker crashed'))
    await failed
    const next = index.list()
    old.emit('exit', 1)
    replacement.emit('message', { requestId: 2, sessions: [] })
    await expect(next).resolves.toEqual([])
    await index.close()
  })

  it('releases an idle SDK heap and can start another scan', async () => {
    vi.useFakeTimers()
    const old = new FakeWorker()
    const replacement = new FakeWorker()
    const factory = vi
      .fn<() => Worker>()
      .mockReturnValueOnce(old as unknown as Worker)
      .mockReturnValueOnce(replacement as unknown as Worker)
    const index = new SessionIndexClient(factory)
    const first = index.list()
    old.emit('message', { requestId: 1, sessions: [] })
    await first
    vi.advanceTimersByTime(30_000)
    expect(old.terminate).toHaveBeenCalledTimes(1)
    const next = index.list()
    old.emit('exit', 1)
    vi.advanceTimersByTime(30_000)
    expect(replacement.terminate).not.toHaveBeenCalled()
    replacement.emit('message', { requestId: 2, sessions: [] })
    await next
    await index.close()
  })

  it('settles pending reads on shutdown and refuses new work', async () => {
    const worker = new FakeWorker()
    const index = new SessionIndexClient(() => worker as unknown as Worker)
    const pending = expect(index.list()).rejects.toThrow('closed')
    await index.close()
    await pending
    await expect(index.list()).rejects.toThrow('closed')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})
