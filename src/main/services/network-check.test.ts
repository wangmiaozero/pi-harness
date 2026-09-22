import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkNetwork } from './network-check'

afterEach(() => vi.useRealTimers())

describe('checkNetwork', () => {
  it('reports a reachable npm registry with latency', async () => {
    const result = await checkNetwork(async () => ({ ok: true }))
    expect(result.reachable).toBe(true)
    expect(result.latencyMs).toBeTypeOf('number')
  })

  it('reports non-success responses and request failures', async () => {
    await expect(checkNetwork(async () => ({ ok: false }))).resolves.toEqual({
      reachable: false,
      latencyMs: null
    })
    await expect(
      checkNetwork(async () => {
        throw new Error('offline')
      })
    ).resolves.toEqual({
      reachable: false,
      latencyMs: null
    })
  })

  it('aborts a stalled request and returns within the timeout', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const result = checkNetwork((requestSignal) => {
      signal = requestSignal
      return new Promise(() => undefined)
    })
    await vi.advanceTimersByTimeAsync(2500)
    await expect(result).resolves.toEqual({ reachable: false, latencyMs: null })
    expect(signal?.aborted).toBe(true)
  })
})
