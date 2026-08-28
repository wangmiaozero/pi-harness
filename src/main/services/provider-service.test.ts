import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderService, resolveEnabledProviderKey } from './provider-service'
import type { PiProviderConfig } from '@shared/types/pi'

const piProvider = {
  api: 'openai-completions' as const,
  models: []
}

describe('ProviderService enabled-state invariant', () => {
  it('selects at most one provider when metadata has multiple enabled entries', async () => {
    const config = {
      read: vi.fn(async () => ({
        models: { providers: { nvidia: piProvider, stepfun: piProvider } },
        settings: { defaultProvider: 'stepfun' },
        modelsMtime: null,
        settingsMtime: null
      }))
    }
    const metadata = {
      read: vi.fn(async () => ({
        providers: {
          nvidia: { enabled: true },
          stepfun: { enabled: true }
        },
        models: {},
        capabilities: {},
        builtinSkills: { schemaVersion: 1, installed: {} }
      }))
    }
    const service = new ProviderService(config as never, metadata as never)

    const providers = await service.list()

    expect(
      providers.filter((provider) => provider.enabled).map((provider) => provider.key)
    ).toEqual(['stepfun'])
  })

  it('uses the active provider while metadata is temporarily missing', () => {
    expect(resolveEnabledProviderKey(['nvidia', 'stepfun'], {}, 'stepfun')).toBe('stepfun')
  })

  it('keeps a known enabled provider selected while a new provider has no metadata', () => {
    expect(
      resolveEnabledProviderKey(['nvidia', 'stepfun'], { nvidia: { enabled: true } }, 'stepfun')
    ).toBe('nvidia')
  })

  it('allows all providers to remain disabled when metadata explicitly disables them', () => {
    expect(
      resolveEnabledProviderKey(
        ['nvidia', 'stepfun'],
        { nvidia: { enabled: false }, stepfun: { enabled: false } },
        'stepfun'
      )
    ).toBeNull()
  })
})

describe('ProviderService model discovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches and parses an OpenAI-compatible model list with draft credentials', async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'acme-chat', name: 'Acme Chat' },
              { id: 'acme-reasoning' },
              { id: 'acme-chat', name: 'Duplicate' }
            ]
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = new ProviderService({} as never, {} as never)

    const models = await service.discoverModels({
      existingProviderKey: null,
      protocol: 'openai-completions',
      baseUrl: 'https://api.acme.test/v1',
      apiKey: { kind: 'literal', literal: 'secret-value' },
      headers: { 'X-Org': 'team' },
      authHeader: true,
      timeout: 5_000
    })

    expect(models).toEqual([
      { id: 'acme-chat', name: 'Acme Chat' },
      { id: 'acme-reasoning', name: 'acme-reasoning' }
    ])
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.acme.test/v1/models')
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer secret-value',
      'X-Org': 'team'
    })
  })

  it('follows Google model-list pagination and normalizes model ids', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }],
            nextPageToken: 'next-page'
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash' }] }), {
          status: 200
        })
      )
    vi.stubGlobal('fetch', fetchMock)
    const service = new ProviderService({} as never, {} as never)

    const models = await service.discoverModels({
      protocol: 'google-generative-ai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: { kind: 'literal', literal: 'google-key' },
      headers: {},
      authHeader: false,
      timeout: null
    })

    expect(models.map((model) => model.id)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash'])
    expect(String(fetchMock.mock.calls[1]![0])).toContain('pageToken=next-page')
  })

  it('returns an empty list when the provider exposes no models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    )
    const service = new ProviderService({} as never, {} as never)

    await expect(
      service.discoverModels({
        protocol: 'openai-completions',
        baseUrl: 'https://api.empty.test/v1',
        apiKey: null,
        headers: {},
        authHeader: true,
        timeout: null
      })
    ).resolves.toEqual([])
  })

  it('falls back to Volcengine OpenAI-style /v3/models when Anthropic /v1/models is missing', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.includes('/api/plan/v1/models') || href.endsWith('/api/plan/models')) {
        return new Response('{"error":"not found"}', { status: 404 })
      }
      if (href.includes('/api/plan/v3/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'glm-5.3', name: 'GLM 5.3' }] }), {
          status: 200
        })
      }
      return new Response('unexpected', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const service = new ProviderService({} as never, {} as never)

    const models = await service.discoverModels({
      protocol: 'anthropic-messages',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
      apiKey: { kind: 'literal', literal: 'ark-key' },
      headers: {},
      authHeader: false,
      timeout: 5_000
    })

    expect(models).toEqual([{ id: 'glm-5.3', name: 'GLM 5.3' }])
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://ark.cn-beijing.volces.com/api/plan/v1/models?limit=100',
      'https://ark.cn-beijing.volces.com/api/plan/models',
      'https://ark.cn-beijing.volces.com/api/plan/v3/models'
    ])
  })

  it('treats a missing Anthropic model catalog as empty instead of failing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"type":"not_found"}', { status: 404 }))
    )
    const service = new ProviderService({} as never, {} as never)

    await expect(
      service.discoverModels({
        protocol: 'anthropic-messages',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
        apiKey: { kind: 'literal', literal: 'ark-key' },
        headers: {},
        authHeader: false,
        timeout: null
      })
    ).resolves.toEqual([])
  })

  it('does not fail Agent Plan discovery when fallback catalog endpoints error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 }))
    )
    const service = new ProviderService({} as never, {} as never)

    await expect(
      service.discoverModels({
        protocol: 'anthropic-messages',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
        apiKey: { kind: 'literal', literal: 'ark-key' },
        headers: {},
        authHeader: false,
        timeout: null
      })
    ).resolves.toEqual([])
  })

  it('still fails OpenAI-compatible discovery on HTTP 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 }))
    )
    const service = new ProviderService({} as never, {} as never)

    await expect(
      service.discoverModels({
        protocol: 'openai-completions',
        baseUrl: 'https://api.failure.test/v1',
        apiKey: null,
        headers: {},
        authHeader: true,
        timeout: null
      })
    ).rejects.toThrow(/HTTP 404/)
  })

  it('merges discovered models into a new provider without duplicating ids', async () => {
    const providers: Record<string, PiProviderConfig> = {}
    const metadataState = {
      providers: {},
      models: {},
      capabilities: {},
      builtinSkills: { schemaVersion: 1, installed: {} }
    }
    const config = {
      read: vi.fn(async () => ({
        models: { providers },
        settings: {},
        modelsMtime: null,
        settingsMtime: null
      })),
      patchProvider: vi.fn(
        async (
          key: string,
          update: (current: PiProviderConfig | undefined) => PiProviderConfig
        ) => {
          providers[key] = update(undefined)
        }
      ),
      getActiveModel: vi.fn(async () => ({ providerKey: null, modelId: null })),
      setActiveModel: vi.fn(async () => undefined)
    }
    const metadata = {
      read: vi.fn(async () => metadataState),
      update: vi.fn(async (patch: Partial<typeof metadataState>) =>
        Object.assign(metadataState, patch)
      )
    }
    const service = new ProviderService(config as never, metadata as never)

    const created = await service.create({
      key: 'acme',
      name: 'acme',
      displayName: 'Acme',
      enabled: false,
      protocol: 'openai-completions',
      baseUrl: 'https://api.acme.test/v1',
      apiKey: null,
      headers: {},
      authHeader: true,
      timeout: null,
      defaultModelId: 'acme-chat',
      discoveredModels: [
        { id: 'acme-chat', name: 'Acme Chat' },
        { id: 'acme-chat', name: 'Duplicate' },
        { id: 'acme-reasoning', name: 'Acme Reasoning' }
      ]
    })

    expect(providers.acme?.models?.map((model) => model.id)).toEqual([
      'acme-chat',
      'acme-reasoning'
    ])
    expect(providers.acme?.models?.every((model) => model.api === undefined)).toBe(true)
    expect(created.name).toBe('acme')
  })
})

function providerForm(overrides: Record<string, unknown> = {}) {
  return {
    key: 'zhipuai',
    name: 'zhipuai',
    displayName: 'ZhipuAI',
    enabled: false,
    protocol: 'anthropic-messages',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    apiKey: null,
    headers: {},
    authHeader: true,
    timeout: null,
    ...overrides
  }
}

describe('ProviderService protocol updates', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rewrites inherited model api when the provider protocol changes', async () => {
    const providers: Record<string, PiProviderConfig> = {
      zhipuai: {
        api: 'openai-completions',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        models: [
          { id: 'chat-a', name: 'chat-a', api: 'openai-completions' },
          { id: 'chat-b', name: 'chat-b', api: 'openai-completions' },
          { id: 'other', name: 'other', api: 'openai-responses' }
        ]
      }
    }
    const metadataState = {
      providers: { zhipuai: { enabled: false } },
      models: {},
      capabilities: {},
      builtinSkills: { schemaVersion: 1, installed: {} }
    }
    const config = {
      read: vi.fn(async () => ({
        models: { providers },
        settings: {},
        modelsMtime: null,
        settingsMtime: null
      })),
      patchProvider: vi.fn(
        async (
          key: string,
          update: (current: PiProviderConfig | undefined) => PiProviderConfig
        ) => {
          providers[key] = update(providers[key])
        }
      )
    }
    const metadata = {
      read: vi.fn(async () => metadataState),
      update: vi.fn(async (patch: Partial<typeof metadataState>) =>
        Object.assign(metadataState, patch)
      ),
      write: vi.fn(async (next: typeof metadataState) => Object.assign(metadataState, next))
    }
    const service = new ProviderService(config as never, metadata as never)

    await service.update('zhipuai', providerForm())

    expect(providers.zhipuai?.api).toBe('anthropic-messages')
    expect(providers.zhipuai?.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic')
    expect(providers.zhipuai?.models?.map((model) => [model.id, model.api])).toEqual([
      ['chat-a', undefined],
      ['chat-b', undefined],
      ['other', 'openai-responses']
    ])
  })

  it('probes with the model api, not the provider api', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"ok"}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const providers: Record<string, PiProviderConfig> = {
      zhipuai: {
        api: 'anthropic-messages',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        models: [{ id: 'chat-a', name: 'chat-a', api: 'openai-completions' }]
      }
    }
    const config = {
      read: vi.fn(async () => ({
        models: { providers },
        settings: {},
        modelsMtime: null,
        settingsMtime: null
      }))
    }
    const metadata = {
      read: vi.fn(async () => ({
        providers: { zhipuai: { enabled: true } },
        models: {},
        capabilities: {},
        builtinSkills: { schemaVersion: 1, installed: {} }
      }))
    }
    const service = new ProviderService(config as never, metadata as never)

    const result = await service.testConnection({ providerKey: 'zhipuai', modelId: 'chat-a' })

    expect(result.protocol).toBe('openai-completions')
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://open.bigmodel.cn/api/anthropic/chat/completions'
    )
  })
})
