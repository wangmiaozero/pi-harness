export const NAV_ITEM_IDS = [
  'workspace',
  'overview',
  'providers',
  'models',
  'skills',
  'settings'
] as const

export type NavItemId = (typeof NAV_ITEM_IDS)[number]

export const DEFAULT_NAV_ORDER: NavItemId[] = [...NAV_ITEM_IDS]

const NAV_ITEM_ID_SET = new Set<string>(NAV_ITEM_IDS)

export function isNavItemId(value: unknown): value is NavItemId {
  return typeof value === 'string' && NAV_ITEM_ID_SET.has(value)
}

export function normalizeNavOrder(value: unknown): NavItemId[] {
  const seen = new Set<NavItemId>()
  const next: NavItemId[] = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isNavItemId(item) || seen.has(item)) continue
      seen.add(item)
      next.push(item)
    }
  }
  for (const id of NAV_ITEM_IDS) {
    if (!seen.has(id)) next.push(id)
  }
  return next
}

export function moveNavItem(order: readonly NavItemId[], from: number, to: number): NavItemId[] {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) {
    return [...order]
  }
  const next = [...order]
  const [item] = next.splice(from, 1)
  if (item === undefined) return next
  next.splice(to, 0, item)
  return next
}
