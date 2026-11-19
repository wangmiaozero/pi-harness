import { afterEach, expect, it, vi } from 'vitest'
import { ProviderService } from './provider-service'
import type { PiProviderConfig } from '@shared/types/pi'
vi.mock('electron', () => ({ app: {}, safeStorage: { isEncryptionAvailable: () => false } }))
afterEach(() => vi.unstubAllGlobals())
function service(native: Partial<PiProviderConfig> = {}) {
  return new ProviderService(
    {
      read: async () => ({
        models: {
          providers: {
            fixture: {
              api: 'openai-completions',
              baseUrl: 'https://fixture.invalid/v1',
              models: [{ id: 'fixture' }],
              ...native
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
  [407, 'proxy_auth_error'],
  [503, 'upstream_error']
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
  ).toMatchObject({ ok: false, status: 'network_error' })
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
  ['ENOTFOUND', 'dns_error'],
  ['CERT_HAS_EXPIRED', 'tls_certificate_error'],
  ['ERR_SSL_PROTOCOL_ERROR', 'tls_handshake_error'],
  ['ECONNREFUSED', 'connection_refused'],
  ['ENETUNREACH', 'network_unreachable'],
  ['UND_ERR_CONNECT_TIMEOUT', 'connection_timeout'],
  ['UND_ERR_BODY_TIMEOUT', 'timeout'],
  ['ERR_PROXY_CONNECTION_FAILED', 'proxy_error'],
  ['ERR_PROXY_AUTH_REQUESTED', 'proxy_auth_error'],
  ['ETIMEDOUT', 'network_error']
])('explains transport cause %s', async (code, status) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { cause: { code } } })
    })
  )
  expect(
    await service().testConnection({ providerKey: 'fixture', modelId: 'fixture' })
  ).toMatchObject({ ok: false, status, errorCode: code })
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

it('probes an unsaved provider without saving its credentials or reflecting them in failures', async () => {
  const literal = 'fixture-unpublished-secret'
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ error: { message: 'Invalid credential ' + literal } }, { status: 401 })
    )
  vi.stubGlobal('fetch', fetcher)
  const result = await service().testConnection({
    modelId: 'candidate',
    draft: {
      baseUrl: 'https://fixture.invalid/v1',
      protocol: 'openai-completions',
      apiKey: { kind: 'literal', literal },
      headers: {},
      authHeader: true,
      timeout: null
    }
  })
  expect(result.status).toBe('auth_error')
  expect(JSON.stringify(result)).not.toContain(literal)
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    'https://fixture.invalid/v1/chat/completions',
    expect.objectContaining({ redirect: 'error' })
  )
})

it('distinguishes its deadline from caller cancellation, including after response headers', async () => {
  const deadline = new AbortController()
  const original = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  const cancellation = new AbortController()
  let dispatch!: () => void
  const dispatched = () =>
    new Promise<void>((resolve) => {
      dispatch = resolve
    })
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    return new Response(
      new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), {
            once: true
          })
        },
        pull() {
          dispatch()
        }
      })
    )
  })
  vi.stubGlobal('fetch', fetcher)
  try {
    const firstStarted = dispatched()
    const first = service().testConnection({ providerKey: 'fixture' }, cancellation.signal)
    await firstStarted
    cancellation.abort(new Error('synthetic-cancellation-details'))
    await expect(first).resolves.toMatchObject({ status: 'cancelled', httpStatus: 200 })

    const secondStarted = dispatched()
    const second = service().testConnection({ providerKey: 'fixture' })
    await secondStarted
    deadline.abort(new DOMException('fixture deadline', 'TimeoutError'))
    await expect(second).resolves.toMatchObject({ status: 'timeout', httpStatus: 200 })
  } finally {
    original.mockRestore()
  }
})

it('strips URL query credentials from diagnostics and does not copy upstream text or headers', async () => {
  const secret = 'fixture-private-google-token'
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ error: { message: 'different-opaque-header-secret' } }, { status: 401 })
    )
  vi.stubGlobal('fetch', fetcher)
  const result = await service().testConnection({
    modelId: 'fixture',
    draft: {
      baseUrl: 'https://fixture.invalid/v1beta?access_token=another-opaque-secret',
      protocol: 'google-generative-ai',
      apiKey: { kind: 'literal', literal: secret },
      headers: { Cookie: 'different-opaque-header-secret' },
      authHeader: false,
      timeout: null
    }
  })
  const url = new URL(String(fetcher.mock.calls[0]?.[0]))
  expect(url.searchParams.get('key')).toBe(secret)
  expect(url.searchParams.get('access_token')).toBe('another-opaque-secret')
  expect(result).toMatchObject({
    endpoint: 'https://fixture.invalid/v1beta/models/fixture:generateContent',
    status: 'auth_error'
  })
  expect(JSON.stringify(result)).not.toMatch(
    /fixture-private-google-token|different-opaque-header-secret|another-opaque-secret/
  )
})

it('reports a recognized response in a different API shape as a protocol mismatch', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Response.json({ output: [{ type: 'message' }] }))
  )
  await expect(service().testConnection({ providerKey: 'fixture' })).resolves.toMatchObject({
    status: 'protocol_error',
    httpStatus: 200,
    network: { proxyMode: 'auto', transport: 'node_fetch' }
  })
})

it.each([
  ['https://api.openai.com/v1', 'max_completion_tokens', 32],
  ['https://compatible.invalid/v1', 'max_tokens', 1],
  ['https://api.openai.com.compatible.invalid/v1', 'max_tokens', 1]
] as const)(
  'uses the correct Chat Completions token field at %s',
  async (baseUrl, field, limit) => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      if (
        body[field] !== limit ||
        Object.hasOwn(body, field === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens')
      )
        return Response.json(
          { error: { code: 'unsupported_parameter', param: 'max_tokens' } },
          { status: 400 }
        )
      return Response.json({ choices: [{ message: { content: '' }, finish_reason: 'length' }] })
    })
    vi.stubGlobal('fetch', fetcher)
    await expect(
      service().testConnection({
        modelId: 'gpt-6-astra',
        draft: {
          baseUrl,
          protocol: 'openai-completions',
          apiKey: null,
          headers: {},
          authHeader: true,
          timeout: null
        }
      })
    ).resolves.toMatchObject({ status: 'success', endpoint: `${baseUrl}/chat/completions` })
    expect(fetcher).toHaveBeenCalledOnce()
  }
)

it('reports only recognized fields from an upstream HTTP 400 error', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'unsupported_parameter',
            param: 'max_tokens',
            message: 'fixture-credential-in-message'
          }
        },
        { status: 400 }
      )
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'fixture-unknown-code',
            param: 'fixture-unknown-param',
            message: 'fixture-secret'
          }
        },
        { status: 422 }
      )
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          error: { code: 'model_not_found', param: 'model' }
        },
        { status: 400 }
      )
    )
    .mockResolvedValueOnce(new Response('<html>fixture-private-page</html>', { status: 400 }))
  vi.stubGlobal('fetch', fetcher)
  const probe = () => service().testConnection({ providerKey: 'fixture' })
  const unsupported = await probe()
  expect(unsupported).toMatchObject({
    status: 'request_error',
    httpStatus: 400,
    upstreamError: { code: 'unsupported_parameter', parameter: 'max_tokens' }
  })
  expect(JSON.stringify(unsupported)).not.toContain('fixture-credential-in-message')
  const unknown = await probe()
  expect(unknown).toMatchObject({ status: 'request_error', httpStatus: 422 })
  expect(unknown.upstreamError).toBeUndefined()
  expect(JSON.stringify(unknown)).not.toMatch(
    /fixture-unknown-code|fixture-unknown-param|fixture-secret/
  )
  await expect(probe()).resolves.toMatchObject({ status: 'model_not_found', httpStatus: 400 })
  await expect(probe()).resolves.toMatchObject({ status: 'request_error', httpStatus: 400 })
})

it('accepts a Responses probe that exhausts its own output budget', async () => {
  const body = {
    output: [],
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' }
  }
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(body))
    .mockResolvedValueOnce(
      Response.json({ ...body, incomplete_details: { reason: 'content_filter' } })
    )
  vi.stubGlobal('fetch', fetcher)
  const probe = () =>
    service().testConnection({
      modelId: 'gpt-6-astra',
      draft: {
        baseUrl: 'https://api.openai.com/v1',
        protocol: 'openai-responses',
        apiKey: null,
        headers: {},
        authHeader: true,
        timeout: null
      }
    })
  await expect(probe()).resolves.toMatchObject({ status: 'success', httpStatus: 200 })
  await expect(probe()).resolves.toMatchObject({ status: 'model_error', httpStatus: 200 })
})

it('preserves explicit model token-field compatibility when probing a saved relay', async () => {
  const configured = service({
    compat: { maxTokensField: 'max_tokens' },
    modelOverrides: { fixture: { compat: { maxTokensField: 'max_completion_tokens' } } }
  })
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const payload = JSON.parse(String(init?.body))
    expect(payload).toHaveProperty('max_completion_tokens', 32)
    expect(payload).not.toHaveProperty('max_tokens')
    return Response.json({ choices: [{ message: { content: 'ok' } }] })
  })
  vi.stubGlobal('fetch', fetcher)
  await expect(configured.testConnection({ providerKey: 'fixture' })).resolves.toMatchObject({
    status: 'success'
  })
})

it.each([
  ['https://api.openai.com/v1', { max_tokens: 32 }, { max_completion_tokens: 32 }],
  [
    'https://api.openai.com/v1',
    { max_tokens: 32, max_completion_tokens: 64 },
    { max_completion_tokens: 64 }
  ],
  ['https://relay.invalid/v1', { max_tokens: 32 }, { max_tokens: 32 }]
])(
  'normalizes legacy token limits only for the official Chat Completions gateway upstream %s',
  async (baseUrl, body, expected) => {
    const configured = service({ baseUrl })
    const payload = { ...body, model: 'fixture/fixture' }
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ model: 'fixture', ...expected })
      return Response.json({ choices: [{ message: { content: 'ok' } }] })
    })
    vi.stubGlobal('fetch', fetcher)
    const response = await configured.gatewayRequest(
      'openai-completions',
      payload,
      new Headers(),
      new AbortController().signal
    )
    expect(response.status).toBe(200)
    expect(payload).toEqual({ ...body, model: 'fixture/fixture' })
  }
)
