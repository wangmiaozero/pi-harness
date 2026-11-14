import type { PiThinkingLevel } from '../constants'

export const FREE_PROVIDER_KEY = 'pi-harness-free'

export type FreeModelStatus =
  'unverified' | 'available' | 'region' | 'limited' | 'quota' | 'upstream' | 'unavailable'

export interface FreeModelRow {
  id: string
  name: string
  source: 'Kilo'
  status: FreeModelStatus
  vision: boolean
  tools: boolean
  reasoning: boolean
  thinkingLevels: Partial<Record<PiThinkingLevel, string | null>>
  retryAt?: number
}

export interface FreeModelSnapshot {
  models: FreeModelRow[]
  fetchedAt: number | null
  stale: boolean
  refreshing: boolean
  privacyAccepted: boolean
  catalog: 'loading' | 'ready' | 'offline'
}
