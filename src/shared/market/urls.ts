const PACK_ID = /^[a-z0-9][a-z0-9-]*$/
const SEGMENT = /^[\w][\w.-]*$/

export type MarketUrlKind = 'theme' | 'pet'

/** Build a `pi-market://` URL. Callers must not pass filesystem paths. */
export function marketFileUrl(kind: MarketUrlKind, id: string, assetPath: string): string {
  if (kind !== 'theme' && kind !== 'pet') throw new Error('Invalid market resource kind')
  if (!PACK_ID.test(id)) throw new Error('Invalid market resource id')
  const parts = assetPath.split('/')
  if (
    parts.length === 0 ||
    parts.some((part) => part.length === 0 || part === '.' || part === '..' || !SEGMENT.test(part))
  ) {
    throw new Error('Invalid market asset path')
  }
  return `pi-market://${kind}/${id}/${parts.map((part) => encodeURIComponent(part)).join('/')}`
}

export interface ParsedMarketUrl {
  kind: MarketUrlKind
  id: string
  parts: string[]
}

export function parseMarketUrl(value: string): ParsedMarketUrl | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'pi-market:' || (parsed.host !== 'theme' && parsed.host !== 'pet')) {
    return null
  }
  const segments = decodeURIComponent(parsed.pathname).split('/').filter(Boolean)
  if (segments.length < 2 || segments.length > 8) return null
  const [id, ...parts] = segments
  if (!PACK_ID.test(id)) return null
  if (
    parts.some(
      (part) => part.length === 0 || part === '.' || part === '..' || !SEGMENT.test(part)
    )
  ) {
    return null
  }
  return { kind: parsed.host, id, parts }
}
