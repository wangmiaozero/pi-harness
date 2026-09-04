import generatedCatalog from './provider-presets.generated.json'
import type { PiInputType } from './index'
import type { ProtocolId } from './protocols'

export interface ProviderPresetModel {
  id: string
  name: string
  contextWindow?: number
  maxOutputTokens?: number
  input?: readonly PiInputType[]
}

export interface ProviderPreset {
  id: string
  name: string
  protocol: ProtocolId
  defaultBaseUrl: string
  placeholderApiKey: string
  authHeader: boolean
  defaultModelId: string
  documentation: string
  sources: readonly string[]
  models: readonly ProviderPresetModel[]
}

const genericPresets: readonly ProviderPreset[] = [
  {
    id: 'openai-compatible',
    name: 'OpenAI Compatible',
    protocol: 'openai-completions',
    defaultBaseUrl: '',
    placeholderApiKey: 'sk-...',
    authHeader: true,
    defaultModelId: '',
    documentation: 'Any endpoint implementing OpenAI Chat Completions.',
    sources: ['Pi-Harness'],
    models: []
  },
  {
    id: 'anthropic-compatible',
    name: 'Anthropic Compatible',
    protocol: 'anthropic-messages',
    defaultBaseUrl: '',
    placeholderApiKey: 'sk-ant-...',
    authHeader: false,
    defaultModelId: '',
    documentation: 'Any endpoint implementing the Anthropic Messages API.',
    sources: ['Pi-Harness'],
    models: []
  }
]

const importedPresets = generatedCatalog.providers as unknown as ProviderPreset[]

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [...genericPresets, ...importedPresets]

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase().replace('127.0.0.1', 'localhost')
}

export function findProviderPreset(input: {
  key?: string | null
  protocol?: ProtocolId | null
  baseUrl?: string | null
}): ProviderPreset | undefined {
  const key = input.key?.trim()
  const protocol = input.protocol ?? undefined
  if (key) {
    const byKey = PROVIDER_PRESETS.find(
      (preset) => preset.id === key && (!protocol || preset.protocol === protocol)
    )
    if (byKey) return byKey
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? '')
  if (!baseUrl) return undefined
  return PROVIDER_PRESETS.find(
    (preset) =>
      normalizeBaseUrl(preset.defaultBaseUrl) === baseUrl &&
      (!protocol || preset.protocol === protocol)
  )
}
