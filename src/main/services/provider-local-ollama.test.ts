import { describe, expect, it, vi } from 'vitest'
import type { ProviderForm } from '@shared/schemas/domain'
import type { PiProviderConfig } from '@shared/types/pi'
import { providerToDomain } from '../pi/adapter'
import { ProviderService } from './provider-service'

vi.mock('electron', () => ({ app: {}, safeStorage: { isEncryptionAvailable: () => false } }))

function fixture(initial: Record<string, PiProviderConfig> = {}) {
  const providers = structuredClone(initial)
  let meta = { providers: {}, models: {} }
  const config = {
    read: async () => ({ models: { providers }, settings: {} }),
    getActiveModel: vi.fn(async () => ({ providerKey: 'existing', modelId: 'existing-model' })),
    setActiveModel: vi.fn(),
    patchProvider: async (
      key: string,
      update: (provider: PiProviderConfig | undefined) => PiProviderConfig
    ) => {
      providers[key] = update(providers[key])
    }
  }
  const metadata = {
    read: async () => meta,
    update: async (patch: typeof meta) => {
      meta = { ...meta, ...patch }
    },
    write: async (next: typeof meta) => {
      meta = next
    }
  }
  const form: ProviderForm = {
    key: 'ollama',
    name: 'ollama',
    displayName: 'Ollama',
    enabled: true,
    protocol: 'openai-completions',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: null,
    headers: {},
    authHeader: true,
    timeout: null,
    defaultModelId: null
  }
  return {
    providers,
    config,
    form,
    service: new ProviderService(config as never, metadata as never)
  }
}

describe('local Ollama credentials', () => {
  it('keeps the compatibility value inside Native config and omits it from the credential UI', async () => {
    const { service, form, providers, config } = fixture()
    const profile = await service.create(form)
    expect(providers.ollama.apiKey).toBe('ollama')
    expect(providers.ollama.authHeader).toBe(false)
    expect(profile.localNoAuth).toBe(true)
    expect(profile.apiKey).toBeNull()
    expect(profile.apiKeyRef).toBeNull()
    expect(config.setActiveModel).not.toHaveBeenCalled()
    await service.update('ollama', { ...form, displayName: 'My Ollama' })
    expect(providers.ollama.apiKey).toBe('ollama')
    expect((await service.get('ollama'))?.localNoAuth).toBe(true)
  })

  it('preserves a configured credential source for an authenticated local service', async () => {
    const { service, form, providers } = fixture()
    const profile = await service.create({
      ...form,
      apiKey: { kind: 'env', envRef: '$OLLAMA_TEST_KEY' }
    })
    expect(profile.localNoAuth).toBe(false)
    expect(profile.apiKey).toMatchObject({ kind: 'env', envRef: '$OLLAMA_TEST_KEY' })
    expect(providers.ollama.authHeader).toBe(true)
  })

  it('preserves existing models and their limits and capabilities while editing a local placeholder', async () => {
    const models = [
      {
        id: 'fixture-local',
        name: 'Fixture local',
        contextWindow: 256000,
        maxTokens: 16384,
        input: ['text', 'image'] as ('text' | 'image')[],
        reasoning: true
      }
    ]
    const { service, form, providers, config } = fixture({
      ollama: {
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: 'ollama',
        models,
        headers: { 'X-Fixture': 'preserved' }
      }
    })
    await service.update('ollama', {
      ...form,
      defaultModelId: 'fixture-local',
      headers: { 'X-Fixture': 'preserved' }
    })
    expect(providers.ollama.models).toEqual(models)
    expect(providers.ollama.headers).toEqual({ 'X-Fixture': 'preserved' })
    expect(config.setActiveModel).not.toHaveBeenCalled()
  })

  it.each(['https://ollama.com/v1', 'https://api.example.com/v1', 'http://127.0.0.1:1234/v1'])(
    'keeps other endpoints on the regular credential path: %s',
    async (baseUrl) => {
      const { service, form, providers } = fixture()
      const profile = await service.create({ ...form, baseUrl })
      expect(profile.localNoAuth).toBe(false)
      expect(providers.ollama.apiKey).toBeUndefined()
    }
  )

  it('recognizes legacy placeholders while preserving real keys and authentication headers', () => {
    const base = { baseUrl: 'http://localhost:11434/v1', api: 'openai-completions' as const }
    for (const apiKey of [undefined, 'ollama', 'local']) {
      expect(providerToDomain('local', { ...base, apiKey }, undefined).localNoAuth).toBe(true)
    }
    for (const pi of [
      { ...base, apiKey: 'fixture-real-key' },
      { ...base, apiKey: '$OLLAMA_TEST_KEY' },
      { ...base, apiKey: '!fixture-command' },
      { ...base, apiKey: 'ollama', headers: { Authorization: 'Bearer fixture-auth' } }
    ]) {
      const profile = providerToDomain('local', pi, undefined)
      expect(profile.localNoAuth).toBe(false)
      expect(profile.apiKey).not.toBeNull()
      expect(JSON.stringify(profile)).not.toContain('fixture-real-key')
    }
    expect(
      providerToDomain('local', { ...base, apiKey: 'ollama' }, { apiKeyRef: 'saved-fixture' })
        .localNoAuth
    ).toBe(false)
  })
})
