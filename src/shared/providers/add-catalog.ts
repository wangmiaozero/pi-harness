import type { ProviderPreset } from '@shared/constants/provider-presets'

/** Magpie's add sheet groups. Partners stay empty unless a live id matches a preset. */
export const ADD_CATALOG_GROUPS = [
  'partner',
  'subscription',
  'vendor',
  'relay',
  'local',
  'custom'
] as const

export type AddCatalogGroup = (typeof ADD_CATALOG_GROUPS)[number]

export const ADD_CATALOG_SUBSCRIPTIONS = [
  { id: 'chatgpt', name: 'ChatGPT', cli: 'codex', support: 'oauth', apiPresetId: 'openai' },
  { id: 'claude', name: 'Claude', cli: 'claude', support: 'cli', apiPresetId: 'anthropic' },
  { id: 'gemini', name: 'Gemini CLI', cli: 'gemini', support: 'cli', apiPresetId: 'google' },
  { id: 'copilot', name: 'GitHub Copilot', support: 'unsupported' }
] as const

export type AddCatalogSubscription = (typeof ADD_CATALOG_SUBSCRIPTIONS)[number]
export type AddCatalogSubscriptionId = AddCatalogSubscription['id']

const VENDOR_IDS = new Set([
  'anthropic',
  'openai',
  'google',
  'deepseek',
  'xai',
  'moonshot',
  'moonshot-ai',
  'moonshot-cn',
  'kimi-for-coding',
  'zhipuai',
  'zhipuai-coding-plan',
  'zai',
  'zai-coding-plan',
  'minimax',
  'minimax-cn',
  'minimax-anthropic',
  'minimax-coding-plan',
  'minimax-cn-coding-plan',
  'stepfun',
  'step-plan',
  'xiaomi',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-sgp',
  'doubao',
  'baichuan',
  'ark-code',
  'bailian-coding-plan',
  'qwen',
  'mistral-ai',
  'groq'
])

const RELAY_IDS = new Set([
  'openrouter',
  'together-ai',
  'fireworks',
  'siliconflow',
  'siliconflow-com',
  'aihubmix',
  'modelscope',
  'nvidia',
  'vercel-ai-gateway',
  'github',
  'huggingface',
  'novita',
  'ppinfra',
  'qiniu',
  'tokenflux',
  'zenmux',
  'flymux-anthropic',
  'flymux-openai',
  'new-api',
  'o3fan',
  'jiekou',
  'upstage'
])

const LOCAL_IDS = new Set(['ollama', 'lm-studio', 'lmstudio'])

export function classifyAddPreset(
  preset: Pick<ProviderPreset, 'id' | 'defaultBaseUrl'>,
  partnerIds: readonly string[] = []
): AddCatalogGroup {
  if (partnerIds.includes(preset.id)) return 'partner'
  if (preset.id.endsWith('-compatible')) return 'custom'
  if (
    LOCAL_IDS.has(preset.id) ||
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?=[:/]|$)/.test(preset.defaultBaseUrl)
  )
    return 'local'
  if (RELAY_IDS.has(preset.id)) return 'relay'
  if (VENDOR_IDS.has(preset.id)) return 'vendor'
  return preset.defaultBaseUrl ? 'vendor' : 'custom'
}

export interface AddCatalogSection {
  group: AddCatalogGroup
  presets: readonly ProviderPreset[]
  subscriptions: readonly AddCatalogSubscription[]
}

const GROUP_ORDER: Record<AddCatalogGroup, readonly string[]> = {
  partner: [],
  subscription: [],
  vendor: [
    'anthropic',
    'openai',
    'google',
    'deepseek',
    'xai',
    'moonshot',
    'moonshot-ai',
    'kimi-for-coding',
    'zhipuai',
    'zai',
    'minimax',
    'stepfun',
    'xiaomi',
    'qwen',
    'mistral-ai',
    'groq'
  ],
  relay: [
    'openrouter',
    'vercel-ai-gateway',
    'together-ai',
    'fireworks',
    'siliconflow',
    'siliconflow-com',
    'nvidia',
    'modelscope',
    'aihubmix'
  ],
  local: ['ollama', 'lm-studio'],
  custom: ['openai-compatible', 'anthropic-compatible']
}

function sortPresets(group: AddCatalogGroup, presets: readonly ProviderPreset[]): ProviderPreset[] {
  const order = GROUP_ORDER[group]
  return [...presets].sort((left, right) => {
    const leftIndex = order.indexOf(left.id)
    const rightIndex = order.indexOf(right.id)
    return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex)
  })
}

export function buildAddCatalog(
  presets: readonly ProviderPreset[],
  query: string,
  partnerIds: readonly string[] = []
): AddCatalogSection[] {
  const needle = query.trim().toLowerCase()
  const hit = (id: string, name: string) =>
    !needle || id.toLowerCase().includes(needle) || name.toLowerCase().includes(needle)
  const subscriptions = ADD_CATALOG_SUBSCRIPTIONS.filter((item) => hit(item.id, item.name))
  const grouped = new Map<AddCatalogGroup, ProviderPreset[]>()
  for (const preset of presets) {
    if (!hit(preset.id, preset.name)) continue
    const group = classifyAddPreset(preset, partnerIds)
    const list = grouped.get(group) ?? []
    list.push(preset)
    grouped.set(group, list)
  }
  return ADD_CATALOG_GROUPS.flatMap((group) => {
    const sectionPresets = sortPresets(group, grouped.get(group) ?? [])
    const sectionSubscriptions = group === 'subscription' ? subscriptions : []
    if (sectionPresets.length === 0 && sectionSubscriptions.length === 0) return []
    return [{ group, presets: sectionPresets, subscriptions: sectionSubscriptions }]
  })
}
