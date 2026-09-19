/**
 * Codex-aligned composer catalog. `ultra` is a UI-only alias; the adapter
 * resolves it to the highest Pi thinking level the current model supports.
 */
export const COMPOSER_THINKING_LEVELS = [
  'auto',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
] as const
export type ComposerThinkingLevel = (typeof COMPOSER_THINKING_LEVELS)[number]

export const DEFAULT_AVAILABLE_THINKING_LEVELS = COMPOSER_THINKING_LEVELS.slice(1)

export function thinkingLabelKey(level: string): string {
  return `workspace.thinking${level.charAt(0).toUpperCase()}${level.slice(1)}`
}

export function resolveAvailableThinkingLevels(
  _thinkingLevels?: Partial<Record<string, string | null>> | null
): string[] {
  return [...DEFAULT_AVAILABLE_THINKING_LEVELS]
}

export function composerThinkingLevels(available?: readonly string[] | null): string[] {
  void available
  return [...COMPOSER_THINKING_LEVELS]
}

export function thinkingIndex(level: string, levels: readonly string[]): number {
  const index = levels.indexOf(level)
  if (index >= 0) return index
  const medium = levels.indexOf('medium')
  return medium >= 0 ? medium : Math.max(0, Math.ceil((levels.length - 1) / 2))
}

export function thinkingLevelAt(index: number, levels: readonly string[]): string {
  return levels[Math.min(Math.max(index, 0), Math.max(levels.length - 1, 0))] ?? 'medium'
}

export function clampThinkingLevel(level: string, levels: readonly string[]): string {
  return levels.includes(level) ? level : (levels[0] ?? 'auto')
}

export function thinkingEffectState(level: string, levels: readonly string[]) {
  const last = Math.max(levels.length - 1, 0)
  const index = thinkingIndex(level, levels)
  const named = levels.findIndex((item) => item === 'medium')
  const igniteIndex = named >= 0 ? named : Math.ceil(last * 0.5)
  const ignited = last > 0 && index >= igniteIndex
  const namedMax = levels.findIndex((item) => item === 'max')
  const max = last > 0 && index >= (namedMax >= 0 ? namedMax : last)
  const span = Math.max(last - igniteIndex, 1)
  const power = max ? 1 : ignited ? 0.32 + 0.68 * ((index - igniteIndex) / span) : 0
  return { ignited, max, power, index, last }
}
