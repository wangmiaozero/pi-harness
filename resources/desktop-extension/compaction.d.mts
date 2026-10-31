import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
export interface CompactionDefaults {
  maxOutputTokens: number
  contextWindow?: number
  reasoning?: boolean
  thinkingLevels?: Partial<Record<ThinkingLevel, string | null>>
  forceEffort?: boolean
}
export function installCompactionPolicy(
  pi: ExtensionAPI,
  resolveDefaults?: (model: {
    provider: string
    id: string
    baseUrl: string
  }) => CompactionDefaults | undefined | Promise<CompactionDefaults | undefined>,
  compactNative?: typeof import('@earendil-works/pi-coding-agent').compact
): void
