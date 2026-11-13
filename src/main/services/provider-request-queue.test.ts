// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { AccountRequestQueue, ProviderRequestQueue } from './provider-request-queue'

it('rejects excess waiters, releases aborted requests and hands off in order', async () => {
  const queue = new ProviderRequestQueue()
  const settings = { concurrency: 1, queueLimit: 1 }
  const first = await queue.acquire(settings, new AbortController().signal)
  const waiting = new AbortController()
  const next = queue.acquire(settings, waiting.signal)
  const aborted = expect(next).rejects.toThrow('Aborted')
  await expect(queue.acquire(settings, new AbortController().signal)).rejects.toThrow('full')
  waiting.abort(new Error('Aborted'))
  await aborted
  const last = queue.acquire(settings, new AbortController().signal)
  first()
  const release = await last
  release()
})

it('counts distinct accounts and starts a queued account after the last stream closes', async () => {
  const queue = new AccountRequestQueue()
  const settings = { maxAccounts: 1 }
  const signal = new AbortController().signal
  const first = await queue.acquire('one', settings, signal)
  const second = await queue.acquire('one', settings, signal)
  const start = vi.fn()
  const next = queue.acquire('two', settings, signal).then((release) => {
    start()
    return release
  })
  first()
  await Promise.resolve()
  expect(start).not.toHaveBeenCalled()
  second()
  const release = await next
  release()
  expect(start).toHaveBeenCalledOnce()
})
