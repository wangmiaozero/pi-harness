import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderService, resolveEnabledProviderKey } from './provider-service'
import type { PiProviderConfig, PiSettingsConfig } from '@shared/types/pi'

vi.mock('electron', () => ({
  app: {},
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false)
  }
}))

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

describe('ProviderService image models', () => {
  afterEach(() => vi.unstubAllGlobals())

  function imageService(fallbackModels: string[] = []) {
    const config = {
      read: vi.fn(async () => ({
        models: {
          providers: {
            stepfun: {
              api: 'openai-completions',
              baseUrl: 'https://api.stepfun.com/step_plan/v1',
              authHeader: true,
              models: [
                { id: 'step-image-edit-2', name: 'Step Image Edit 2' },
                ...fallbackModels.map((id) => ({ id, name: id }))
              ]
            }
          }
        },
        settings: {},
        modelsMtime: null,
        settingsMtime: null
      }))
    }
    const metadata = {
      read: vi.fn(async () => ({
        providers: { stepfun: { enabled: true } },
        models: {},
        capabilities: {},
        builtinSkills: { schemaVersion: 1, installed: {} }
      }))
    }
    return new ProviderService(config as never, metadata as never)
  }

  it('uses the generations endpoint when no source image is supplied', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw==' }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await imageService().invokeImageModel({
      providerKey: 'stepfun',
      modelId: 'step-image-edit-2',
      prompt: 'ink landscape',
      size: '1024x1024'
    })

    expect(result).toMatchObject({ mimeType: 'image/png', base64: 'iVBORw==' })
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://api.stepfun.com/step_plan/v1/images/generations'
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject({
      model: 'step-image-edit-2',
      prompt: 'ink landscape',
      response_format: 'b64_json',
      cfg_scale: 1,
      steps: 8,
      seed: 1,
      text_mode: false
    })
  })

  it('uses multipart image edits when a source image is supplied', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw==' }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await imageService().invokeImageModel({
      providerKey: 'stepfun',
      modelId: 'step-image-edit-2',
      prompt: 'add clouds',
      size: '1024x1024',
      sourceImage: {
        mimeType: 'image/png',
        base64: 'iVBORw==',
        fileName: 'source.png'
      }
    })

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://api.stepfun.com/step_plan/v1/images/edits'
    )
    const body = fetchMock.mock.calls[0]![1]?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('model')).toBe('step-image-edit-2')
    expect(body.get('prompt')).toBe('add clouds')
    expect(body.get('image')).toBeInstanceOf(Blob)
    expect(body.get('cfg_scale')).toBe('1')
    expect(body.get('steps')).toBe('8')
    expect(body.get('seed')).toBe('1')
    expect(body.get('text_mode')).toBe('false')
  })

  it('retries temporary image engine failures and re-creates the request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'The engine is currently overloaded' } }),
          { status: 503, headers: { 'Retry-After': '0' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'The engine is currently overloaded' } }),
          { status: 503, headers: { 'Retry-After': '0' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw==' }] }), { status: 200 })
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await imageService().invokeImageModel({
      providerKey: 'stepfun',
      modelId: 'step-image-edit-2',
      prompt: 'ink landscape',
      size: '1024x1024'
    })

    expect(result).toMatchObject({ mimeType: 'image/png', base64: 'iVBORw==' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry quota exhaustion responses', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'AccountQuotaExceeded', message: 'You have exceeded the usage quota' }
          }),
          { status: 429 }
        )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      imageService().invokeImageModel({
        providerKey: 'stepfun',
        modelId: 'step-image-edit-2',
        prompt: 'ink landscape',
        size: '1024x1024'
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a recoverable error after temporary failures exhaust all attempts', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: 'The engine is currently overloaded' } }),
          { status: 503, headers: { 'Retry-After': '0' } }
        )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      imageService().invokeImageModel({
        providerKey: 'stepfun',
        modelId: 'step-image-edit-2',
        prompt: 'ink landscape',
        size: '1024x1024'
      })
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      recoverable: true,
      message:
        'Image request failed after 4 attempts (HTTP 503): The engine is currently overloaded'
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('falls back to a sanitized SVG from a configured Step reasoning model', async () => {
    const overloaded = () =>
      new Response(
        JSON.stringify({ error: { message: 'The engine is currently overloaded' } }),
        { status: 503, headers: { 'Retry-After': '0' } }
      )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '<svg width="10" height="10"><rect width="10" height="10" fill="#123456"/></svg>'
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await imageService(['step-5-preview', 'step-3.7-flash']).invokeImageModel({
      providerKey: 'stepfun',
      modelId: 'step-image-edit-2',
      prompt: 'ink landscape',
      size: '768x1360'
    })

    expect(result).toMatchObject({
      mimeType: 'image/svg+xml',
      fallbackModelId: 'step-5-preview',
      fallbackKind: 'svg'
    })
    const svg = Buffer.from(result.base64, 'base64').toString('utf8')
    expect(svg).toContain('width="1360"')
    expect(svg).toContain('height="768"')
    expect(String(fetchMock.mock.calls[4]![0])).toBe(
      'https://api.stepfun.com/step_plan/v1/chat/completions'
    )
    expect(JSON.parse(String(fetchMock.mock.calls[4]![1]?.body))).toMatchObject({
      model: 'step-5-preview'
    })
  })
})

describe('ProviderService API key reveal', () => {
  it('reveals an imported plaintext key without exposing it through provider profiles', async () => {
    const config = {
      read: vi.fn(async () => ({
        models: {
          providers: {
            imported: {
              api: 'openai-completions',
              baseUrl: 'https://api.example.test/v1',
              apiKey: 'sk-imported-secret',
              models: []
            }
          }
        },
        settings: {},
        modelsMtime: null,
        settingsMtime: null
      }))
    }
    const metadata = {
      read: vi.fn(async () => ({
        providers: {},
        models: {},
        capabilities: {},
        builtinSkills: { schemaVersion: 1, installed: {} }
      }))
    }
    const service = new ProviderService(config as never, metadata as never)

    await expect(service.revealApiKey('imported')).resolves.toBe('sk-imported-secret')
    const profile = await service.get('imported')
    expect(profile?.apiKey?.kind).toBe('literal')
    expect(profile?.apiKey?.literal).toBeUndefined()
  })
})

describe('ProviderService deletion state repair', () => {
  it('returns settings to the unconfigured state after deleting the last provider', async () => {
    const providers: Record<string, PiProviderConfig> = {
      deepseek: {
        api: 'openai-completions',
        models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }]
      }
    }
    let settings: PiSettingsConfig = {
      defaultProvider: 'stale-provider',
      defaultModel: 'deepseek-flash',
      theme: 'dark'
    }
    const metadataState = {
      providers: { deepseek: { enabled: true } },
      models: {},
      capabilities: {},
      builtinSkills: { schemaVersion: 1, installed: {} }
    }
    const config = {
      read: vi.fn(async () => ({
        models: { providers },
        settings,
        modelsMtime: null,
        settingsMtime: null
      })),
      patchProvider: vi.fn(
        async (
          key: string,
          update: (current: PiProviderConfig | undefined) => PiProviderConfig | undefined
        ) => {
          const next = update(providers[key])
          if (next === undefined) delete providers[key]
          else providers[key] = next
        }
      ),
      getActiveModel: vi.fn(async () => ({
        providerKey: settings.defaultProvider ?? null,
        modelId: settings.defaultModel ?? null
      })),
      patchSettings: vi.fn(async (update: (current: typeof settings) => typeof settings) => {
        settings = update(settings)
      })
    }
    const metadata = {
      read: vi.fn(async () => metadataState),
      write: vi.fn(async (next: typeof metadataState) => Object.assign(metadataState, next))
    }
    const service = new ProviderService(config as never, metadata as never)

    await service.delete('deepseek')

    expect(providers).toEqual({})
    expect(settings).toEqual({ theme: 'dark' })
    expect(config.patchSettings).toHaveBeenCalledOnce()
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
              {
                id: 'acme-chat',
                name: 'Acme Chat',
                architecture: { input_modalities: ['text', 'image'] }
              },
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
      { id: 'acme-chat', name: 'Acme Chat', input: ['text', 'image'] },
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
    expect(providers.acme?.models?.every((model) => model.input?.includes('image'))).toBe(false)
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
    const fetchMock = vi.fn(
      async (_input: string | URL | Request) => new Response('{"id":"ok"}', { status: 200 })
    )
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
