import { PI_THINKING_LEVELS, toPiThinkingLevel, type PiThinkingLevel } from '../constants/index'

export type HarnessThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra'

export const THINKING_PRIORITY = PI_THINKING_LEVELS

const HARNESS_LEVELS = new Set<string>([...PI_THINKING_LEVELS, 'ultra', 'none', 'auto'])

export function isKnownHarnessThinkingLevel(level: string): boolean {
  return HARNESS_LEVELS.has(level)
}

export function getSupportedThinkingLevels(
  source?: Partial<Record<string, string | null>> | readonly string[] | null
): PiThinkingLevel[] {
  if (Array.isArray(source)) {
    const allowed = new Set(source.map(String))
    const matched = PI_THINKING_LEVELS.filter((level) => allowed.has(level))
    return matched.length > 0 ? [...matched] : [...PI_THINKING_LEVELS]
  }
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const map = source as Partial<Record<string, string | null>>
    const matched = PI_THINKING_LEVELS.filter((level) => {
      const value = map[level]
      return value != null && String(value).trim() !== ''
    })
    if (matched.length > 0) return [...matched]
  }
  return [...PI_THINKING_LEVELS]
}

export function highestSupportedThinkingLevel(
  supportedLevels?: readonly string[] | null
): PiThinkingLevel {
  const supported = getSupportedThinkingLevels(supportedLevels)
  return supported[supported.length - 1] ?? 'medium'
}

export function resolveThinkingLevel(input: {
  requested: string
  supportedLevels?: Partial<Record<string, string | null>> | readonly string[] | null
}): PiThinkingLevel {
  const supported = getSupportedThinkingLevels(input.supportedLevels)
  if (input.requested === 'ultra') return highestSupportedThinkingLevel(supported)
  const mapped = toPiThinkingLevel(input.requested) as PiThinkingLevel
  if (supported.includes(mapped)) return mapped
  return clampThinkingToSupported(mapped, supported)
}

export function resolveCompactionThinkingLevel(level: string): PiThinkingLevel {
  const requested = level === 'none' ? 'off' : level
  if (
    requested === 'ultra' ||
    requested === 'max' ||
    requested === 'xhigh' ||
    requested === 'high'
  ) {
    return 'medium'
  }
  if (
    requested === 'off' ||
    requested === 'minimal' ||
    requested === 'low' ||
    requested === 'medium'
  ) {
    return requested
  }
  return 'medium'
}

function clampThinkingToSupported(
  requested: PiThinkingLevel,
  supported: readonly PiThinkingLevel[]
): PiThinkingLevel {
  const requestedIndex = THINKING_PRIORITY.indexOf(requested)
  for (let index = requestedIndex; index >= 0; index -= 1) {
    const candidate = THINKING_PRIORITY[index]
    if (candidate && supported.includes(candidate)) return candidate
  }
  return supported[0] ?? 'medium'
}
