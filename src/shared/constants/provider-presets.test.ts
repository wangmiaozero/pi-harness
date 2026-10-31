import { describe, expect, it } from 'vitest'
import { PROTOCOL_IDS } from '@shared/constants/protocols'
import {
  findProviderPreset,
  findModelPreset,
  resolveModelDefaults,
  suggestedModelPresets,
  PROVIDER_PRESETS,
  resolveModelInput
} from '@shared/constants/provider-presets'

describe('provider preset catalog', () => {
  it('contains the merged Pi-compatible provider/model catalog', () => {
    const imported = PROVIDER_PRESETS.filter((preset) => !preset.sources.includes('Pi-Harness'))
    const modelCount = imported.reduce((total, preset) => total + preset.models.length, 0)

    expect(imported.length).toBeGreaterThanOrEqual(50)
    expect(modelCount).toBeGreaterThan(2_000)
    expect(new Set(PROVIDER_PRESETS.map((preset) => preset.id)).size).toBe(PROVIDER_PRESETS.length)
    expect(PROVIDER_PRESETS.every((preset) => PROTOCOL_IDS.includes(preset.protocol))).toBe(true)
    expect(
      imported.every(
        (preset) =>
          !preset.defaultModelId ||
          preset.models.some((model) => model.id === preset.defaultModelId)
      )
    ).toBe(true)
  })

  it('provides editable Pi defaults for representative providers', () => {
    expect(findProviderPreset({ key: 'deepseek' })).toMatchObject({
      protocol: 'openai-completions',
      defaultBaseUrl: 'https://api.deepseek.com',
      defaultModelId: 'deepseek-flash'
    })
    expect(findProviderPreset({ key: 'anthropic' })).toMatchObject({
      protocol: 'anthropic-messages',
      defaultBaseUrl: 'https://api.anthropic.com'
    })
    expect(findProviderPreset({ key: 'google' })).toMatchObject({
      protocol: 'google-generative-ai',
      defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta'
    })
  })

  it('matches an existing provider by normalized endpoint', () => {
    expect(
      findProviderPreset({
        key: 'custom-name',
        protocol: 'openai-completions',
        baseUrl: 'https://api.deepseek.com/'
      })?.id
    ).toBe('deepseek')
  })

  it('excludes media-only and utility model APIs', () => {
    const modelIds = PROVIDER_PRESETS.flatMap((preset) => preset.models.map((model) => model.id))
    expect(modelIds).not.toContain('chatgpt-image-latest')
    expect(modelIds).not.toContain('gpt-realtime-2.1')
    expect(modelIds).not.toContain('gemini-2.5-pro-preview-tts')
  })

  it('imports multimodal capabilities from the Pi model catalog generically', () => {
    const declared = PROVIDER_PRESETS.flatMap((preset) => preset.models).filter(
      (model) => model.input
    )
    const multimodal = declared.filter((model) => model.input?.includes('image'))

    expect(declared.length).toBeGreaterThan(1_000)
    expect(multimodal.length).toBeGreaterThan(500)
    expect(
      findProviderPreset({ key: 'stepfun' })?.models.find((model) => model.id === 'step-3.7-flash')
        ?.input
    ).toEqual(['text', 'image'])
    expect(findModelPreset('gpt-4o', findProviderPreset({ key: 'openai' }))?.input).toEqual([
      'text',
      'image'
    ])
    expect(
      findModelPreset('claude-sonnet-4-5-20250929', findProviderPreset({ key: 'anthropic' }))?.input
    ).toEqual(['text', 'image'])
  })

  it('ships the current GLM flash model as multimodal', () => {
    for (const providerId of ['zhipuai', 'zhipuai-coding-plan']) {
      const preset = findProviderPreset({ key: providerId })
      expect(preset?.defaultModelId).toBe('glm-5.3-flash')
      expect(preset?.models.find((model) => model.id === 'glm-5.3-flash')?.input).toEqual([
        'text',
        'image'
      ])
    }
  })

  it('uses current catalog input modes before stale local model metadata', () => {
    expect(
      resolveModelInput({
        providerKey: 'zhipuai-coding-plan',
        modelId: 'glm-5.3-flash',
        configuredInput: ['text']
      })
    ).toEqual(['text', 'image'])
    expect(
      resolveModelInput({
        providerKey: 'stepfun',
        modelId: 'step-3.7-flash',
        configuredInput: ['text']
      })
    ).toEqual(['text', 'image'])
    expect(
      resolveModelInput({
        providerKey: 'custom-provider',
        modelId: 'custom-vision',
        configuredInput: ['text', 'image']
      })
    ).toEqual(['text', 'image'])
  })

  it('suggests current models and resolves older typed ids without recommending them', () => {
    const openai = findProviderPreset({ key: 'openai' })!
    expect(suggestedModelPresets(openai).map((m) => m.id)).toEqual([
      'gpt-6-astra',
      'gpt-6.1-sol',
      'gpt-6.1-terra',
      'gpt-6-luna'
    ])
    expect(findModelPreset('gpt-6-astra', openai)).toMatchObject({
      contextWindow: 1050000,
      maxOutputTokens: 128000,
      reasoning: true,
      tools: true,
      streaming: true,
      input: ['text', 'image'],
      thinkingLevels: { off: null, minimal: null, low: 'low', max: 'max' }
    })
    const ark = findProviderPreset({ key: 'ark-code' })!
    expect(suggestedModelPresets(ark).map((m) => m.id)).not.toContain('kimi-k2.7-code')
    expect(findModelPreset('kimi-k2.7-code', ark)?.contextWindow).toBe(262144)
    expect(findModelPreset('KIMI-K3.1-PRO', ark)).toMatchObject({
      maxOutputTokens: 1048576,
      thinkingLevels: { off: null, medium: null, low: 'low', max: 'max' }
    })
    expect(findModelPreset('glm-5.3', ark)?.thinkingLevels).toMatchObject({
      off: null,
      medium: null,
      low: 'low',
      high: 'high',
      max: 'max'
    })
    expect(
      findModelPreset('deepseek-v4.1-flash', findProviderPreset({ key: 'deepseek' }))?.id
    ).toBe('deepseek-flash')
    expect(findModelPreset('unknown-model')).toBeUndefined()
    expect(
      findModelPreset('kimi-k3.1-pro', findProviderPreset({ key: 'moonshot' }))
    ).toBeUndefined()
    expect(findModelPreset('kimi-k3.1-pro')).toBeUndefined()
    expect(suggestedModelPresets(findProviderPreset({ key: 'ollama' }))).toEqual([])
  })
})

it('supplies complete compatible defaults for common and unlisted models', () => {
  expect(resolveModelDefaults('private-future-model')).toMatchObject({
    contextWindow: 128000,
    maxOutputTokens: 8192,
    thinkingLevels: { low: 'low', medium: 'medium', high: 'high' }
  })
  expect(resolveModelDefaults('o3', findProviderPreset({ key: 'openai' }))).toMatchObject({
    contextWindow: 200000,
    maxOutputTokens: 100000,
    reasoning: true
  })
  expect(resolveModelDefaults('gpt-oss:20b', findProviderPreset({ key: 'ollama' }))).toMatchObject({
    contextWindow: 131072,
    thinkingLevels: { off: null, low: 'low', medium: 'medium', high: 'high', max: null }
  })
})
