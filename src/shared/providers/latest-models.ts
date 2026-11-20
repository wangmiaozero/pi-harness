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

/** The one model that stays visible: most recently added, then most recently updated. */
export function pickNewestModel<
  T extends { id: string; createdAt: number; updatedAt: number }
>(models: readonly T[]): T | undefined {
  if (!models.length) return undefined
  return models.reduce((best, model) => {
    if (model.createdAt !== best.createdAt) return model.createdAt > best.createdAt ? model : best
    if (model.updatedAt !== best.updatedAt) return model.updatedAt > best.updatedAt ? model : best
    return model.id < best.id ? model : best
  })
}
