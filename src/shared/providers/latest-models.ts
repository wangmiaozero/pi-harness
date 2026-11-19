import { findProviderPreset, suggestedModelPresets } from '../constants/provider-presets'
import type { ProtocolId } from '../constants/protocols'
import { CODEX_RECOMMENDED_MODELS } from './account-management'

/**
 * Lower-cased ids of a provider's current models: Codex's set for OpenAI, the
 * vendor's recommended catalog elsewhere; undefined when the vendor has no list.
 */
export function latestModelIds(provider: {
  key: string
  protocol: ProtocolId
  baseUrl: string
}): Set<string> | undefined {
  const preset = findProviderPreset(provider)
  if (!preset) return
  if (preset.id === 'openai') return new Set(CODEX_RECOMMENDED_MODELS)
  const models = suggestedModelPresets(preset)
  if (!models.length) return
  return new Set(
    models.flatMap((model) => [model.id, ...(model.aliases ?? [])]).map((id) => id.toLowerCase())
  )
}
