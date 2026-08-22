import { describe, expect, it } from 'vitest'
import { PROTOCOL_IDS } from '@shared/constants/protocols'
import { findProviderPreset, PROVIDER_PRESETS } from '@shared/constants/provider-presets'

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
      defaultModelId: 'deepseek-v4-flash'
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
})
