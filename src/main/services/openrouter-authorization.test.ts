// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import type { ProviderService } from './provider-service'
import { OpenRouterAuthorization } from './openrouter-authorization'

const realFetch = globalThis.fetch
const exchangeUrl = 'https://openrouter.ai/api/v1/auth/keys'

afterEach(() => vi.unstubAllGlobals())

it('exchanges a loopback callback and passes the key only to Main provider storage', async () => {
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    if (input === exchangeUrl) return Response.json({ key: 'fixture-openrouter-key' })
    return realFetch(input, init)
  })
  vi.stubGlobal('fetch', transport)
  const create = vi.fn<ProviderService['create']>().mockResolvedValue({
    key: 'fixture-provider'
  } as Awaited<ReturnType<ProviderService['create']>>)
  const service = new OpenRouterAuthorization({ create })
  let callbackResult: Promise<Response> | undefined

  const result = await service.connect(async (authorizationUrl) => {
    const authorization = new URL(authorizationUrl)
    expect(authorization.origin).toBe('https://openrouter.ai')
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    const callback = new URL(authorization.searchParams.get('callback_url')!)
    expect(callback.hostname).toBe('127.0.0.1')
    callback.searchParams.set('code', 'fixture-code')
    callbackResult = realFetch(callback)
    await callbackResult
  })

  expect(result).toBe('fixture-provider')
  expect((await callbackResult)?.status).toBe(200)
  const exchange = transport.mock.calls.find(([input]) => input === exchangeUrl)?.[1]
  expect(exchange).toMatchObject({ method: 'POST', redirect: 'error' })
  expect(create).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModelId: 'openrouter/auto-code',
      apiKey: { kind: 'literal', literal: 'fixture-openrouter-key' }
    })
  )
})

it('cancels a pending sign-in before saving a key', async () => {
  const create = vi.fn<ProviderService['create']>()
  const service = new OpenRouterAuthorization({ create })
  let signalOpened!: () => void
  const opened = new Promise<void>((resolve) => {
    signalOpened = resolve
  })
  const pending = service.connect(async () => signalOpened())
  await opened
  await expect(service.connect(async () => {})).rejects.toThrow('unavailable')
  service.cancel()
  await expect(pending).rejects.toMatchObject({ details: { reason: 'cancelled' } })
  expect(create).not.toHaveBeenCalled()
})
