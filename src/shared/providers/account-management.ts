export const CHATGPT_PROVIDER_PREFIX = 'chatgpt-account-'
export const CHATGPT_MODEL_ID = /^[A-Za-z0-9._:-]{1,128}$/

export interface LocalAccount {
  source: 'codex' | 'claude' | 'gemini'
  status: 'missing' | 'signedOut' | 'detected' | 'unsupported' | 'failed'
  authentication?: 'subscription' | 'apiKey' | 'other'
}

export interface ChatGptAccount {
  id: string
  label: string
  status: 'authorized' | 'expired'
  catalogUpdatedAt?: number
  catalogFailed?: boolean
  defaultModelId?: string
  fallbackRank?: number
  models: {
    id: string
    name: string
    reasoning: boolean
    vision: boolean
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
