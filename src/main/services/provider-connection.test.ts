import { afterEach, expect, it, vi } from 'vitest'
import { ProviderService } from './provider-service'
vi.mock('electron', () => ({ app: {}, safeStorage: { isEncryptionAvailable: () => false } }))
afterEach(() => vi.unstubAllGlobals())
function service() {
  return new ProviderService(
    {
      read: async () => ({
        models: {
          providers: {
            fixture: {
              api: 'openai-completions',
              baseUrl: 'https://fixture.invalid/v1',
              models: [{ id: 'fixture' }]
            }
          }
        },
        settings: {}
      })
    } as never,
    { read: async () => ({ providers: { fixture: { enabled: true } }, models: {} }) } as never
  )
}
it.each([
  [401, 'auth_error'],
  [403, 'forbidden'],
  [404, 'model_not_found'],
  [429, 'rate_limited'],
  [503, 'endpoint_error']
])('diagnoses HTTP %s without exposing credentials', async (http, expected) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('{"error":{"message":"Bearer synthetic-secret-token"}}', {
          status: Number(http)
        })
    )
  )
  const result = await service().testConnection({ providerKey: 'fixture', modelId: 'fixture' })
  expect(result.ok).toBe(false)
  expect(result.status).toBe(expected)
  expect(result.message).not.toContain('synthetic-secret-token')
})
it.each(['<html>Login</html>', '', 'null', '[]', '{}', '{"choices":[]}'])(
  'rejects a false-positive HTTP 200 response: %s',
  async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 }))
    )
    expect(
      await service().testConnection({ providerKey: 'fixture', modelId: 'fixture' })
    ).toMatchObject({ ok: false, status: 'invalid_response' })
  }
)
it.each(['AbortError', 'TypeError'])('diagnoses a transport %s', async (name) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw Object.assign(new Error('Transport failure'), { name })
    })
  )
  expect(
    await service().testConnection({ providerKey: 'fixture', modelId: 'fixture' })
  ).toMatchObject({ ok: false, status: name === 'AbortError' ? 'timeout' : 'network_error' })
})

it('accepts a real response shape for the configured protocol', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('{"choices":[{"message":{"role":"assistant","content":"ok"}}]}', {
          status: 200
        })
    )
  )
  expect(
    await service().testConnection({ providerKey: 'fixture', modelId: 'fixture' })
  ).toMatchObject({ ok: true, status: 'success' })
})

it.each([
  ['ENOTFOUND', 'DNS lookup failed'],
  ['CERT_HAS_EXPIRED', 'TLS certificate'],
  ['ECONNREFUSED', 'Connection refused']
])('explains transport cause %s', async (code, message) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code } })
    })
  )
  expect(
    await service().testConnection({ providerKey: 'fixture', modelId: 'fixture' })
  ).toMatchObject({ ok: false, status: 'network_error', message: expect.stringContaining(message) })
})

it('resolves an existing native literal key in Main without returning it to Renderer', async () => {
  const key = 'synthetic-native-literal-key'
  const fetch = vi.fn(async (_url: unknown, input: RequestInit) => {
    expect(input.headers).toMatchObject({ Authorization: `Bearer ${key}` })
    return new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  const config = {
    read: async () => ({
      models: {
        providers: {
          fixture: {
            api: 'openai-completions',
            baseUrl: 'https://fixture.invalid/v1',
            apiKey: key,
            models: [{ id: 'fixture' }]
          }
        }
      },
      settings: {}
    })
  }
  const provider = new ProviderService(
    config as never,
    { read: async () => ({ providers: {}, models: {} }) } as never
  )
  const result = await provider.testConnection({ providerKey: 'fixture', modelId: 'fixture' })
  expect(result.ok).toBe(true)
  expect(JSON.stringify(result)).not.toContain(key)
  expect(fetch).toHaveBeenCalledOnce()
})

it('keeps the endpoint and literal credential bound to one configuration snapshot', async () => {
  const record = (baseUrl: string, apiKey: string) => ({
    models: {
      providers: {
        fixture: { api: 'openai-completions', baseUrl, apiKey, models: [{ id: 'fixture' }] }
      }
    },
    settings: {}
  })
  const read = vi
    .fn()
    .mockResolvedValueOnce(record('https://old.invalid/v1', 'synthetic-old-key'))
    .mockResolvedValue(record('https://new.invalid/v1', 'synthetic-new-key'))
  const fetch = vi.fn(async (url: unknown, input: RequestInit) => {
    expect(url).toBe('https://old.invalid/v1/chat/completions')
    expect(input.headers).toMatchObject({ Authorization: 'Bearer synthetic-old-key' })
    return new Response('{"choices":[{"message":{"content":"ok"}}]}')
  })
  vi.stubGlobal('fetch', fetch)
  const provider = new ProviderService(
    { read } as never,
    { read: async () => ({ providers: {}, models: {} }) } as never
  )
  expect((await provider.testConnection({ providerKey: 'fixture', modelId: 'fixture' })).ok).toBe(
    true
  )
  expect(read).toHaveBeenCalledOnce()
})
