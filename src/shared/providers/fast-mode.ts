import { CHATGPT_PROVIDER_PREFIX } from './account-management'

/** OpenAI priority processing, which Codex calls Fast. */
export const FAST_SERVICE_TIER = 'priority'

const OPENAI_API_ORIGIN = 'https://api.openai.com'

export function isFastModelId(modelId: string): boolean {
  return /^(?:gpt-|o\d)/i.test(modelId)
}

type FastProvider = { key: string; baseUrl?: string | null }

export function providerOffersFastMode(provider: FastProvider): boolean {
  if (provider.key.startsWith(CHATGPT_PROVIDER_PREFIX)) return true
  return URL.parse(provider.baseUrl ?? '')?.origin === OPENAI_API_ORIGIN
}

export function supportsFastMode(provider: FastProvider, modelId: string): boolean {
  return isFastModelId(modelId) && providerOffersFastMode(provider)
}

/** Returns the JSON body with Fast applied, or undefined when it does not apply. */
export function withFastServiceTier(body: string): string | undefined {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  const request = payload as Record<string, unknown>
  if (typeof request.model !== 'string' || !isFastModelId(request.model)) return
  if (request.service_tier !== undefined) return
  return JSON.stringify({ ...request, service_tier: FAST_SERVICE_TIER })
}
