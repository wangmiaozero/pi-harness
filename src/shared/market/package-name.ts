/** Official Market packages. The account name `piharness` does not imply this scope. */

export const OFFICIAL_MARKET_SCOPE = '@pi-harness'
export const OFFICIAL_REGISTRY = 'https://registry.npmjs.org'

export const MARKET_PACKAGE_NAME =
  /^@pi-harness\/(theme|pet)-[a-z0-9][a-z0-9-]*$/

export type MarketPackageKind = 'theme' | 'pet'

export interface ParsedMarketPackageName {
  name: string
  kind: MarketPackageKind
  slug: string
}

export function parseMarketPackageName(value: string): ParsedMarketPackageName | null {
  if (!MARKET_PACKAGE_NAME.test(value)) return null
  const slug = value.slice(`${OFFICIAL_MARKET_SCOPE}/`.length)
  const kind = slug.startsWith('theme-') ? 'theme' : slug.startsWith('pet-') ? 'pet' : null
  if (!kind) return null
  return { name: value, kind, slug: slug.slice(kind.length + 1) }
}

export function assertMarketPackageName(value: string): ParsedMarketPackageName {
  const parsed = parseMarketPackageName(value)
  if (!parsed) throw new Error(`Package name is not an official Pi-Harness market package: ${value}`)
  return parsed
}
