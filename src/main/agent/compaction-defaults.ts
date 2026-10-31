import { findModelPreset, findProviderPreset } from '@shared/constants/provider-presets'
import type { CompactionDefaults } from '../../../resources/desktop-extension/compaction.mjs'

/** Read-only, verified provider limits; never rewrite a user's chat model configuration. */
export function compactionDefaults(input: unknown): CompactionDefaults | undefined {
  if (!input || typeof input !== 'object') return undefined
  const model = input as Record<string, unknown>
  if (typeof model.provider !== 'string' || typeof model.id !== 'string') return undefined
  const provider = findProviderPreset({
    key: model.provider,
    baseUrl: typeof model.baseUrl === 'string' ? model.baseUrl : undefined
  })
  if (!provider || provider.id.endsWith('-compatible')) return undefined
  const defaults = findModelPreset(model.id, provider)
  if (!defaults?.maxOutputTokens) return undefined
  return {
    maxOutputTokens: defaults.maxOutputTokens,
    contextWindow: defaults.contextWindow,
    reasoning: defaults.reasoning,
    thinkingLevels: defaults.thinkingLevels,
    forceEffort: provider.id === 'ark-code'
  }
}
