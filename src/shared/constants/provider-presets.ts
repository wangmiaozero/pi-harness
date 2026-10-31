import generatedCatalog from './provider-presets.generated.json'
import currentCatalog from './current-models.json'
import type { PiThinkingLevel } from './index'
import type { PiInputType } from './index'
import type { ProtocolId } from './protocols'

export interface ProviderPresetModel {
  id: string
  name: string
  contextWindow?: number
  maxOutputTokens?: number
  input?: readonly PiInputType[]
  reasoning?: boolean
  tools?: boolean
  streaming?: boolean
  thinkingLevels?: Partial<Record<PiThinkingLevel, string | null>>
  sources?: readonly string[]
  aliases?: readonly string[]
  recommended?: boolean
  providerScoped?: boolean
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

const CURRENT_MODEL_OVERRIDES = {
  zhipuai: {
    defaultModelId: 'glm-5.3-flash',
    models: [{ id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', input: ['text', 'image'] }]
  },
  'zhipuai-coding-plan': {
    defaultModelId: 'glm-5.3-flash',
    models: [{ id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', input: ['text', 'image'] }]
  }
} as const satisfies Partial<
  Record<
    string,
    {
      defaultModelId?: string
      models: readonly ProviderPresetModel[]
    }
  >
>

function applyCurrentModelOverrides(preset: ProviderPreset): ProviderPreset {
  const latest = (currentCatalog.providers as Record<string, ProviderPresetModel[]>)[preset.id]
  if (latest)
    return {
      ...preset,
      defaultModelId: latest[0].id,
      models: latest.filter((model) => model.recommended !== false)
    }
  const override = CURRENT_MODEL_OVERRIDES[preset.id as keyof typeof CURRENT_MODEL_OVERRIDES]
  if (!override) return preset

  const overriddenIds = new Set<string>(override.models.map((model) => model.id))
  return {
    ...preset,
    defaultModelId: override.defaultModelId,
    models: [...override.models, ...preset.models.filter((model) => !overriddenIds.has(model.id))]
  }
}

const importedPresets = (generatedCatalog.providers as unknown as ProviderPreset[]).map(
  applyCurrentModelOverrides
)

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [...genericPresets, ...importedPresets]

export function findModelPreset(
  modelId: string,
  provider?: ProviderPreset
): ProviderPresetModel | undefined {
  const key = modelId.trim().toLowerCase()
  const matches = (model: ProviderPresetModel) =>
    model.id.toLowerCase() === key || model.aliases?.some((alias) => alias.toLowerCase() === key)
  const local =
    provider && (currentCatalog.providers as Record<string, ProviderPresetModel[]>)[provider.id]
  const exact = (local ?? provider?.models)?.find(matches)
  if (exact) return exact
  const legacy =
    provider &&
    (generatedCatalog.providers as unknown as ProviderPreset[])
      .find((item) => item.id === provider.id)
      ?.models.find(matches)
  if (legacy) return legacy as ProviderPresetModel
  if (provider && !provider.id.endsWith('-compatible')) return undefined
  return (Object.values(currentCatalog.providers).flat() as ProviderPresetModel[]).find(
    (model) => !model.providerScoped && matches(model)
  )
}

export function suggestedModelPresets(provider?: ProviderPreset): readonly ProviderPresetModel[] {
  if (provider) {
    const latest = (currentCatalog.providers as Record<string, ProviderPresetModel[]>)[provider.id]
    if (latest) return latest.filter((model) => model.recommended !== false)
    if (!provider.id.endsWith('-compatible')) return []
  }
  return [
    ...new Map(
      (Object.values(currentCatalog.providers).flat() as ProviderPresetModel[])
        .filter((model) => model.recommended !== false && !model.providerScoped)
        .map((model) => [model.id, model])
    ).values()
  ]
}

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

export function resolveModelInput(input: {
  providerKey: string
  modelId: string
  configuredInput?: readonly PiInputType[]
}): readonly PiInputType[] {
  const catalogInput = findModelPreset(
    input.modelId,
    findProviderPreset({ key: input.providerKey })
  )?.input
  return catalogInput ?? input.configuredInput ?? ['text']
}
