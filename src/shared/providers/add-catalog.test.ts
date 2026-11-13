import { describe, expect, it } from 'vitest'
import { PROVIDER_PRESETS } from '@shared/constants/provider-presets'
import { buildAddCatalog, classifyAddPreset } from './add-catalog'

describe('add provider catalog', () => {
  it('keeps ChatGPT separate from the OpenAI API preset', () => {
    const sections = buildAddCatalog(PROVIDER_PRESETS, '')
    const subscriptions = sections.find((section) => section.group === 'subscription')
    const vendors = sections.find((section) => section.group === 'vendor')
    expect(subscriptions?.subscriptions.map((item) => item.id)).toEqual([
      'chatgpt',
      'openrouter',
      'claude',
      'gemini',
      'copilot'
    ])
    expect(vendors?.presets.some((preset) => preset.id === 'openai')).toBe(true)
    expect(subscriptions?.subscriptions.find((item) => item.id === 'copilot')?.support).toBe(
      'unsupported'
    )
    expect(subscriptions?.subscriptions.find((item) => item.id === 'claude')).toMatchObject({
      support: 'cli',
      apiPresetId: 'anthropic'
    })
  })

  it('offers separate plan and regional endpoints and keeps hosted relays in their group', () => {
    const sections = buildAddCatalog(PROVIDER_PRESETS, '')
    const vendors = sections.find((section) => section.group === 'vendor')?.presets
    const relays = sections.find((section) => section.group === 'relay')?.presets
    expect(vendors?.find((preset) => preset.id === 'qwencloud-token-plan')?.defaultBaseUrl).toBe(
      'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1'
    )
    expect(vendors?.find((preset) => preset.id === 'qwencloud-cn-beijing')?.defaultBaseUrl).toBe(
      'https://cn-beijing.maas.qwencloudapi.com/compatible-mode/v1'
    )
    expect(relays?.map((preset) => preset.id)).toContain('opencode-go')
    expect(new Set(PROVIDER_PRESETS.map((preset) => preset.id)).size).toBe(PROVIDER_PRESETS.length)
  })

  it('searches presets without leaving subscription tiles in an unrelated query', () => {
    const sections = buildAddCatalog(PROVIDER_PRESETS, 'deepseek')
    expect(sections.flatMap((section) => section.presets.map((preset) => preset.id))).toContain(
      'deepseek'
    )
    expect(sections.some((section) => section.group === 'subscription')).toBe(false)
    expect(
      classifyAddPreset({ id: 'openrouter', defaultBaseUrl: 'https://openrouter.ai/api/v1' })
    ).toBe('relay')
    expect(classifyAddPreset({ id: 'ollama', defaultBaseUrl: 'http://127.0.0.1:11434/v1' })).toBe(
      'local'
    )
    expect(classifyAddPreset({ id: 'openai-compatible', defaultBaseUrl: '' })).toBe('custom')
  })

  it('shows a partner only when that id is a configurable preset', () => {
    const sections = buildAddCatalog(PROVIDER_PRESETS, '', ['deepseek', 'not-a-preset'])
    const partners = sections.find((section) => section.group === 'partner')
    expect(partners?.presets.map((preset) => preset.id)).toEqual(['deepseek'])
    expect(
      sections
        .find((section) => section.group === 'vendor')
        ?.presets.some((preset) => preset.id === 'deepseek')
    ).toBe(false)
  })
})
