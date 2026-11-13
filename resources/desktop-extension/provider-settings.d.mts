import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ProviderAdvancedSettings } from '../../src/shared/providers/advanced-settings'
import type { ProtocolId } from '../../src/shared/constants/protocols'

export function applyProviderBody<T>(
  payload: T,
  fields?: ProviderAdvancedSettings['extraBody'],
  sessionId?: string
): T
export function maskProviderPrompt<T>(payload: T): T
export function applyProviderHeaders(
  headers: Record<string, string | null>,
  settings?: ProviderAdvancedSettings,
  protocol?: string,
  sessionId?: string
): Record<string, string | null>
export function installProviderSettings(
  pi: ExtensionAPI,
  load: (provider: string, baseUrl: string) => Promise<ProviderAdvancedSettings | undefined>,
  network: {
    googleBaseUrl?: (provider: string, baseUrl: string) => Promise<string>
    list: () => Promise<{ key: string; protocol: ProtocolId; apiKey?: string; baseUrl?: string }[]>
    fetch: (
      provider: string,
      baseUrl: string,
      ...args: Parameters<typeof fetch>
    ) => Promise<Response>
    acquire: (
      provider: string,
      baseUrl: string,
      signal?: AbortSignal
    ) => Promise<(() => void | Promise<void>) | undefined>
  }
): () => Promise<void>
export function modelLimit(
  limits: Record<string, number> | undefined,
  model: string
): number | undefined
