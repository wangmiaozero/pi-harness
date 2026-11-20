import { describe, expect, it, vi } from 'vitest'
import type { PiProviderConfig } from '@shared/types/pi'
import type { AppMetadata } from './metadata-store'
import { ModelService } from './model-service'

describe('current model defaults and saved overrides', () => {
  it('preserves explicit limits and capabilities, unknown config, and an explicit thinking map', async () => {
    const providers: Record<string, PiProviderConfig> = {
      acme: {
        api: 'openai-completions',
        baseUrl: 'https://api.acme.test/v1',
        vendorOption: { keep: true },
        models: [{ id: 'old', vendorModelOption: true }]
      }
    }
    let meta = {
      providers: {},
      models: {},
      capabilities: {},
      builtinSkills: { schemaVersion: 1, installed: {} }
    } as AppMetadata
    const config = {
      read: async () => ({ models: { providers }, settings: {} }),
      patchProvider: async (
        key: string,
        update: (current: PiProviderConfig) => PiProviderConfig
      ) => {
        providers[key] = update(providers[key])
      }
    }
    const metadata = {
      read: async () => meta,
      write: async (next: AppMetadata) => {
        meta = next
      }
    }
    const service = new ModelService(config as never, metadata as never)
    const model = await service.create({
      providerId: 'acme',
      modelId: 'gpt-6-astra',
      displayName: 'Custom name',
      protocol: 'openai-completions',
      enabled: true,
      reasoning: true,
      vision: true,
      tools: false,
      streaming: false,
      contextWindow: 64000,
      maxOutputTokens: 512,
      thinkingLevels: { low: 'low', off: null }
    })
    expect(model).toMatchObject({
      contextWindow: 64000,
      maxOutputTokens: 512,
      tools: false,
      streaming: false,
      thinkingLevels: { low: 'low', off: null }
    })
    expect(providers.acme.vendorOption).toEqual({ keep: true })
    expect(providers.acme.models?.[0].vendorModelOption).toBe(true)
    const fallback = await service.create({
      providerId: 'acme',
      modelId: 'gpt-6.1-sol',
      displayName: 'Sol',
      protocol: 'openai-completions',
      enabled: true,
      reasoning: true,
      vision: true,
      tools: true,
      streaming: true,
      contextWindow: null,
      maxOutputTokens: null
    })
    expect(fallback).toMatchObject({
      contextWindow: 1050000,
      maxOutputTokens: 128000,
      thinkingLevels: { off: null, minimal: null, low: 'low', max: 'max' }
    })
  })
})

it('shows and hides models without touching Pi config or other model metadata', async () => {
  const providers: Record<string, PiProviderConfig> = {
    openai: {
      api: 'openai-completions',
      baseUrl: 'https://api.openai.com/v1',
      models: [{ id: 'gpt-6.2-sol' }, { id: 'gpt-4.1' }]
    }
  }
  const before = JSON.stringify(providers)
  let meta = {
    providers: {},
    models: { 'openai::gpt-6.2-sol': { displayName: 'Sol', enabled: false, createdAt: 1 } },
    capabilities: {},
    builtinSkills: { schemaVersion: 1, installed: {} }
  } as AppMetadata
  const service = new ModelService(
    { read: async () => ({ models: { providers }, settings: {} }) } as never,
    {
      read: async () => meta,
      mutate: async ({ apply }: { apply: (current: AppMetadata) => AppMetadata }) =>
        (meta = apply(meta))
    } as never
  )

  await expect(service.setVisibility([{ id: 'openai::missing', enabled: true }])).rejects.toThrow(
    'Model not found'
  )
  const listed = await service.setVisibility([
    { id: 'openai::gpt-6.2-sol', enabled: true },
    { id: 'openai::gpt-4.1', enabled: false }
  ])
  expect(listed.map(({ modelId, enabled }) => [modelId, enabled])).toEqual([
    ['gpt-6.2-sol', true],
    ['gpt-4.1', false]
  ])
  expect(meta.models['openai::gpt-6.2-sol']).toMatchObject({
    displayName: 'Sol',
    enabled: true,
    createdAt: 1
  })
  expect(JSON.stringify(providers)).toBe(before)
})

it('fills preset thinking levels only for imported models that never declared reasoning', async () => {
  let models = {
    providers: {
      openai: {
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        vendorOption: { keep: true },
        models: [
          { id: 'gpt-6.2-sol', name: 'gpt-6.2-sol', vendorModelOption: true },
          { id: 'gpt-5-2025-08-07' },
          { id: 'gpt-5.5', reasoning: false },
          { id: 'gpt-6.1-terra', thinkingLevelMap: { high: 'high' } },
          { id: 'gpt-4.1' },
          { id: 'whisper-1' }
        ]
      }
    } as Record<string, PiProviderConfig>
  }
  const patchModels = vi.fn(
    async (mutate: (current: typeof models) => typeof models, options: { reason?: string }) => {
      expect(options.reason).toBeTruthy()
      models = mutate(models)
    }
  )
  const meta = {
    providers: {},
    models: {},
    capabilities: {},
    builtinSkills: { schemaVersion: 1, installed: {} }
  } as AppMetadata
  const service = new ModelService(
    { read: async () => ({ models, settings: {} }), patchModels } as never,
    { read: async () => meta } as never
  )

  expect(await service.fillPresetReasoning()).toBe(2)
  const [sol, snapshot, explicitOff, explicitMap, chat, audio] = models.providers.openai.models!
  expect(sol).toEqual({
    id: 'gpt-6.2-sol',
    name: 'gpt-6.2-sol',
    vendorModelOption: true,
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max'
    }
  })
  expect(snapshot).toMatchObject({ reasoning: true, thinkingLevelMap: { minimal: 'minimal' } })
  expect(explicitOff).toEqual({ id: 'gpt-5.5', reasoning: false })
  expect(explicitMap).toEqual({ id: 'gpt-6.1-terra', thinkingLevelMap: { high: 'high' } })
  expect(chat).toEqual({ id: 'gpt-4.1' })
  expect(audio).toEqual({ id: 'whisper-1' })
  expect(models.providers.openai.vendorOption).toEqual({ keep: true })

  const listed = await service.list()
  expect(listed.find((model) => model.modelId === 'gpt-6.2-sol')?.reasoning).toBe(true)
  expect(listed.find((model) => model.modelId === 'gpt-5.5')?.reasoning).toBe(false)

  patchModels.mockClear()
  expect(await service.fillPresetReasoning()).toBe(0)
  expect(patchModels).not.toHaveBeenCalled()
})
