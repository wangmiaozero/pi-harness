export const CHATGPT_PROVIDER_PREFIX = 'chatgpt-account-'
export const CHATGPT_MODEL_ID = /^[A-Za-z0-9._:-]{1,128}$/

const recommendedChatGptModels = [
  'gpt-6.1-sol',
  'gpt-6-astra',
  'gpt-6.1-terra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna'
]

export function orderChatGptModels<T extends { id: string }>(models: readonly T[]): T[] {
  const rank = (id: string) => {
    const index = recommendedChatGptModels.indexOf(id)
    return index < 0 ? recommendedChatGptModels.length : index
  }
  return [...models].sort((a, b) => rank(a.id) - rank(b.id))
}

export function isSelectableChatGptModel(model: { disabled?: boolean; unsupported?: boolean }) {
  return !model.disabled && !model.unsupported
}

export const CHATGPT_MODEL_MODES = ['catalog', 'selected', 'latest', 'usage'] as const
export type ChatGptModelMode = (typeof CHATGPT_MODEL_MODES)[number]
export type ChatGptModelPreferences = {
  id: string
  mode: ChatGptModelMode
  modelIds: string[]
  addedModelIds: string[]
  routingOnly?: boolean
}

export function latestChatGptModels<T extends { id: string }>(models: readonly T[]): T[] {
  const families = new Map<string, T>()
  for (const model of models) {
    const version = /^gpt-(\d+(?:\.\d+)?)(.*)$/i.exec(model.id)
    const family = version ? `gpt${version[2]}` : model.id
    const previous = families.get(family)
    if (!previous || model.id.localeCompare(previous.id, 'en', { numeric: true }) > 0)
      families.set(family, model)
  }
  return orderChatGptModels([...families.values()])
}

export const CHATGPT_ROUTING_MODES = ['ordered', 'roundRobin'] as const
export type ChatGptRoutingMode = (typeof CHATGPT_ROUTING_MODES)[number]
export type ChatGptModelSelection = { id: string; modelId: string }
export type ChatGptCatalogIssue = {
  reason: 'authorization' | 'http' | 'network' | 'timeout' | 'format' | 'save'
  status?: number
}

export interface SubscriptionAccount {
  id: string
  provider: 'claude' | 'gemini'
  email: string
  plan: string
  modelCount: number
  enabled: boolean
  status: 'authorized' | 'expired'
}

const CHATGPT_PLAN_NAMES: Record<string, string> = {
  plus: 'Plus',
  pro: 'Pro',
  free: 'Free',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  self_serve_business_prolite: 'Business',
  self_serve_business_usage_based: 'Business',
  free_workspace: 'Free',
  ent26: 'Enterprise',
  prolite: 'Pro Lite',
  promax: 'Pro Max',
  edu_plus: 'Edu Plus',
  edu_pro: 'Edu Pro'
}

/** Magpie's account chip: the vendor plus the plan, such as ChatGPT Plus. */
export function chatGptPlanLabel(plan: string): string {
  const key = plan.trim().toLowerCase()
  if (!key) return ''
  const named =
    CHATGPT_PLAN_NAMES[key] ??
    (key.startsWith('enterprise_cbp_')
      ? 'Enterprise'
      : plan.trim()[0].toUpperCase() + plan.trim().slice(1))
  return named.toLowerCase().startsWith('chatgpt') ? named : `ChatGPT ${named}`
}

export interface ChatGptAllowance {
  email?: string
  plan: string
  windows: { seconds: number; usedPercent: number; resetAt?: number }[]
  resets: { count: number; expiresAt?: number; cards?: { expiresAt?: number }[] }
}

export interface ChatGptResetPolicy {
  week: boolean
  expiring: boolean
  leadMinutes: number
}

export interface LocalAccount {
  source: 'codex' | 'claude' | 'gemini'
  status: 'missing' | 'signedOut' | 'detected' | 'unsupported' | 'failed'
  authentication?: 'subscription' | 'apiKey' | 'other'
}

export interface ChatGptAccount {
  id: string
  label: string
  status: 'authorized' | 'expired'
  lastUsedAt?: number
  catalogUpdatedAt?: number
  catalogFailed?: boolean
  catalogIssue?: ChatGptCatalogIssue
  defaultModelId?: string
  recommendedModelId?: string
  routingMode?: ChatGptRoutingMode
  fallbackRank?: number
  modelMode?: ChatGptModelMode
  addedModelIds?: string[]
  routingOnly?: boolean
  resetPolicy?: ChatGptResetPolicy
  models: {
    id: string
    name: string
    reasoning: boolean
    vision: boolean
    contextWindow?: number
    maxOutputTokens?: number
    thinkingLevels?: string[]
    verified: boolean
    disabled?: boolean
    unsupported?: boolean
  }[]
}

export interface QuotaReading {
  provider: string
  source?: 'deepseek' | 'openrouter' | 'minimax'
  kind?: 'balance' | 'keyLimit' | 'subscription'
  status:
    'ok' | 'insufficient' | 'unauthorized' | 'unsupported' | 'failed' | 'rateLimited' | 'stale'
  checkedAt?: number
  balances?: { currency: string; available: string }[]
  keyLimit?: {
    limit?: number
    remaining?: number
    usage?: number
    resetPeriod?: 'daily' | 'weekly' | 'monthly'
  }
  windows?: QuotaWindow[]
}

export interface QuotaWindow {
  model: string
  window: 'current' | 'weekly'
  remainingPercent?: number
  resetAt?: number
  availability?: 'limited' | 'exhausted' | 'unlimited'
}

export interface UsageTotals {
  requests: number
  succeeded: number
  failed: number
  aborted: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  estimatedCost: number | null
}

export interface UsageRange {
  start: number
  end: number
  timeZone: string
  provider?: string
  modelId?: string
}

export interface UsageReport {
  availableModels: { provider: string; id: string }[]
  total: UsageTotals
  days: { day: string; usage: UsageTotals }[]
  providers: { id: string; usage: UsageTotals }[]
  models: { provider: string; id: string; usage: UsageTotals }[]
  retainedRuns: number
  legacyRuns: number
}
