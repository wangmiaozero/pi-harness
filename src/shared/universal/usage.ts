import type { UniversalPart } from './schema'

export function recordedTokens(
  part: Extract<UniversalPart, { type: 'usage' }>
): number | undefined {
  if (part.total !== undefined) return part.total
  // A partial breakdown or cost alone is not a known total.
  if (part.input === undefined || part.output === undefined) return undefined
  return part.input + part.output + (part.cached ?? 0) + (part.cacheWrite ?? 0)
}
