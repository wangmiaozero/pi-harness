import generatedCatalog from './provider-presets.generated.json'
import currentCatalog from './current-models.json'
import commonCatalog from './common-models.json'
import { OFFICIAL_PROVIDER_PRESETS } from './official-provider-presets'
import type { PiThinkingLevel } from './index'
import type { PiInputType } from './index'
import type { ProtocolId } from './protocols'
import { ADDITIONAL_PROVIDER_ENDPOINTS, PROVIDER_ENDPOINT_FAMILIES } from './provider-endpoints'

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
  keyUrl?: string
  catalogGroup?: 'relay'
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

const existingKeyPages: Record<string, string> = {
  deepseek: 'https://platform.deepseek.com/api_keys',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  google: 'https://aistudio.google.com/apikey',
  xai: 'https://console.x.ai/',
  openrouter: 'https://openrouter.ai/settings/keys',
  doubao: 'https://ark.volcengine.com/region:cn-beijing/apikey',
  'kimi-for-coding': 'https://www.kimi.com/code/console'
}

const importedPresets = (generatedCatalog.providers as unknown as ProviderPreset[]).map((preset) =>
  applyCurrentModelOverrides({ ...preset, keyUrl: existingKeyPages[preset.id] })
)

const openAiResponsesPreset: ProviderPreset = {
  id: 'openai-responses',
  name: 'OpenAI Responses',
  protocol: 'openai-responses',
  defaultBaseUrl: 'https://api.openai.com/v1',
  placeholderApiKey: 'sk-...',
  keyUrl: existingKeyPages.openai,
  authHeader: true,
  defaultModelId: 'gpt-6.2-sol',
  documentation: 'OpenAI Responses supports tool calling for GPT-6.2 models.',
  sources: ['Pi-Harness'],
  // The official API allows longer requests. Pi's API-key defaults use the
  // standard pricing window, and the model form lets users choose a longer one.
  models: currentCatalog.providers.openai
    .filter((model) => model.id === 'gpt-6.2-sol' || model.id === 'gpt-6.2-astra')
    .map((model) => ({ ...model, input: ['text', 'image'], contextWindow: 272000 }))
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  ...genericPresets,
  ...importedPresets,
  openAiResponsesPreset,
  ...OFFICIAL_PROVIDER_PRESETS
]

const endpointPresets = [
  ...PROVIDER_PRESETS.filter((preset) => preset.defaultBaseUrl),
  ...ADDITIONAL_PROVIDER_ENDPOINTS.flatMap(({ presetId, ...endpoint }) => {
    const preset = PROVIDER_PRESETS.find(({ id }) => id === presetId)
    return preset ? [{ ...preset, ...endpoint }] : []
  })
]

const endpointsByUrl = new Map<string, ProviderPreset[]>()
for (const preset of endpointPresets) {
  const url = normalizeBaseUrl(preset.defaultBaseUrl)
  const matches = endpointsByUrl.get(url)
  if (matches) matches.push(preset)
  else endpointsByUrl.set(url, [preset])
}

export function getProviderEndpointPresets(presetId?: string): readonly ProviderPreset[] {
  if (!presetId) return []
  const family = PROVIDER_ENDPOINT_FAMILIES.find((ids) => ids.includes(presetId)) ?? []
  // Prefer the active preset when a standard API and a plan share an address.
  return [
    ...endpointPresets.filter(({ id }) => id === presetId),
    ...endpointPresets.filter(({ id }) => id !== presetId && family.includes(id))
  ]
}

export function findProviderEndpoint(
  presets: readonly ProviderPreset[],
  baseUrl: string,
  protocol?: ProtocolId
): ProviderPreset | undefined {
  const url = normalizeBaseUrl(baseUrl)
  return presets.find(
    (preset) =>
      normalizeBaseUrl(preset.defaultBaseUrl) === url && (!protocol || preset.protocol === protocol)
  )
}

export function findModelPreset(
  modelId: string,
  provider?: ProviderPreset
): ProviderPresetModel | undefined {
  const found = findExactModelPreset(modelId, provider)
  if (found) return found
  // Dated snapshots such as gpt-5-2025-08-07 share their base model's capabilities.
  const snapshot = /^(.+)-\d{4}-\d{2}-\d{2}$/.exec(modelId.trim())
  return snapshot ? findExactModelPreset(snapshot[1]!, provider) : undefined
}

function findExactModelPreset(
  modelId: string,
  provider?: ProviderPreset
): ProviderPresetModel | undefined {
  const key = modelId.trim().toLowerCase()
  const matches = (model: ProviderPresetModel) =>
    model.id.toLowerCase() === key || model.aliases?.some((alias) => alias.toLowerCase() === key)
  const local =
    provider && (currentCatalog.providers as Record<string, ProviderPresetModel[]>)[provider.id]
  const exact = local?.find(matches)
  if (exact) return exact
  const common =
    provider &&
    (commonCatalog.providers as Record<string, ProviderPresetModel[]>)[provider.id]?.find(matches)
  if (common) return common
  const configured = provider?.models.find(matches)
  if (configured) return configured
  if (provider?.id === openAiResponsesPreset.id)
    return findExactModelPreset(
      modelId,
      importedPresets.find((preset) => preset.id === 'openai')
    )
  const legacy =
    provider &&
    (generatedCatalog.providers as unknown as ProviderPreset[])
      .find((item) => item.id === provider.id)
      ?.models.find(matches)
  if (legacy) return legacy as ProviderPresetModel
  if (provider && !provider.id.endsWith('-compatible')) return undefined
  return (
    [
      ...Object.values(currentCatalog.providers).flat(),
      ...Object.values(commonCatalog.providers).flat()
    ] as ProviderPresetModel[]
  ).find((model) => !model.providerScoped && matches(model))
}

/** Pi only offers thinking levels for models whose configuration declares reasoning. */
export function presetReasoningFields(
  modelId: string,
  provider?: ProviderPreset
): { reasoning: true; thinkingLevelMap?: Partial<Record<PiThinkingLevel, string | null>> } | null {
  const preset = findModelPreset(modelId, provider)
  if (preset?.reasoning !== true) return null
  return preset.thinkingLevels
    ? { reasoning: true, thinkingLevelMap: { ...preset.thinkingLevels } }
    : { reasoning: true }
}

/** Editable initial values for unlisted endpoints, not a claim about model capacity. */
export const COMPATIBLE_MODEL_DEFAULTS = {
  contextWindow: 128000,
  maxOutputTokens: 8192,
  thinkingLevels: {
    off: 'none',
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: null,
    max: null
  }
} as const

export function resolveModelDefaults(
  modelId: string,
  provider?: ProviderPreset
): ProviderPresetModel {
  const model = findModelPreset(modelId, provider)
  return {
    ...COMPATIBLE_MODEL_DEFAULTS,
    ...model,
    id: modelId,
    name: model?.name ?? modelId,
    contextWindow: model?.contextWindow ?? COMPATIBLE_MODEL_DEFAULTS.contextWindow,
    maxOutputTokens: model?.maxOutputTokens ?? COMPATIBLE_MODEL_DEFAULTS.maxOutputTokens,
    thinkingLevels: model?.thinkingLevels ?? { ...COMPATIBLE_MODEL_DEFAULTS.thinkingLevels }
  }
}

export function suggestedModelPresets(provider?: ProviderPreset): readonly ProviderPresetModel[] {
  if (provider) {
    if (provider.id === openAiResponsesPreset.id || provider.id === 'ark-agent-plan')
      return provider.models
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
  const url = URL.parse(value.trim())
  if (!url) return value.trim().replace(/\/+$/, '')
  if (url.hostname === '127.0.0.1') url.hostname = 'localhost'
  if (url.username || url.password) return url.href
  return url.origin + url.pathname.replace(/\/+$/, '') + url.search + url.hash
}

export function findProviderPreset(input: {
  key?: string | null
  protocol?: ProtocolId | null
  baseUrl?: string | null
}): ProviderPreset | undefined {
  const key = input.key?.trim()
  const protocol = input.protocol ?? undefined
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? '')
  const matches = (endpointsByUrl.get(baseUrl) ?? []).filter(
    (preset) => !protocol || preset.protocol === protocol
  )
  const exactKey = matches.find(({ id }) => id === key)
  if (exactKey) return exactKey
  const family = key && PROVIDER_ENDPOINT_FAMILIES.find((ids) => ids.includes(key))
  const relatedEndpoint = family && matches.find(({ id }) => family.includes(id))
  if (relatedEndpoint) return relatedEndpoint
  const byKey =
    key &&
    PROVIDER_PRESETS.find(
      (preset) =>
        preset.id === key &&
        (!protocol || preset.protocol === protocol) &&
        (preset !== openAiResponsesPreset ||
          !baseUrl ||
          baseUrl === normalizeBaseUrl(preset.defaultBaseUrl))
    )
  return byKey || matches[0]
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
