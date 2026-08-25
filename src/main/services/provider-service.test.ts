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
    expect(created.name).toBe('acme')
  })
})
