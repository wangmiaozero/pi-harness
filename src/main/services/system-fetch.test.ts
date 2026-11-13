// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { systemFetch, withSystemProxyFetch } from './system-fetch'

const electronFetch = vi.hoisted(() =>
  vi.fn(
    async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      new Response('proxy')
  )
)

vi.mock('electron', () => ({
  net: { fetch: electronFetch }
}))

const token = 'https://auth.openai.com/api/accounts/oauth/token'

afterEach(() => {
  electronFetch.mockReset()
  electronFetch.mockResolvedValue(new Response('proxy'))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('scopes the token exchange to its caller and leaves concurrent fetches alone', async () => {
  const nodeFetch = vi.fn(async () => new Response('node'))
  vi.stubGlobal('fetch', nodeFetch)
  let signalStarted!: () => void
  let finish!: () => void
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const request = withSystemProxyFetch(async () => {
    await fetch(token, { method: 'POST' })
    await fetch('https://example.com/health')
    signalStarted()
    await pending
  })
  await started
  await fetch(token)
  await systemFetch('https://api.openai.com/v1/models')
  finish()
  await request
  expect(electronFetch).toHaveBeenCalledTimes(2)
  expect(electronFetch.mock.calls[0][0]).toBe(token)
  expect(electronFetch.mock.calls[1][0]).toBe('https://api.openai.com/v1/models')
  expect(nodeFetch.mock.calls).toEqual([
    ['https://example.com/health', undefined],
    [token, undefined]
  ])
  electronFetch.mockClear()
  await fetch(token)
  expect(electronFetch).not.toHaveBeenCalled()
})

it('bounds a token exchange and follows login cancellation', async () => {
  const controller = new AbortController()
  let seen: AbortSignal | undefined
  electronFetch.mockImplementation(async (_input, init) => {
    seen = init?.signal ?? undefined
    return new Response('ok')
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('node'))
  )
  const scheduled = vi.spyOn(AbortSignal, 'timeout')
  await withSystemProxyFetch(() => fetch(token, { method: 'POST', signal: controller.signal }))
  expect(scheduled).toHaveBeenCalledWith(20_000)
  expect(electronFetch.mock.calls[0][1]?.redirect).toBe('error')
  controller.abort()
  expect(seen?.aborted).toBe(true)
  electronFetch.mockClear()
  scheduled.mockClear()
  await systemFetch('https://api.openai.com/v1/models')
  expect(scheduled).not.toHaveBeenCalled()
  expect((electronFetch.mock.calls[0][1] as RequestInit | undefined)?.signal).toBeUndefined()
})

it('reports the status and allowlisted code without exposing the token response', async () => {
  electronFetch.mockResolvedValueOnce(
    Response.json(
      { error: { code: 'unsupported_country_region_territory', message: 'fixture-secret' } },
      { status: 403 }
    )
  )
  const error = await withSystemProxyFetch(() => fetch(token)).catch((value: unknown) => value)
  expect(error).toMatchObject({
    reason: 'rejected',
    status: 403,
    upstreamCode: 'unsupported_country_region_territory',
    message: 'OAuth exchange: HTTP 403'
  })
})
