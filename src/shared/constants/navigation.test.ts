import { describe, expect, it } from 'vitest'
import { DEFAULT_NAV_ORDER, NAV_ITEM_IDS, moveNavItem, normalizeNavOrder } from './navigation'

describe('navigation order', () => {
  it('defaults to workspace, git, then overview above settings', () => {
    expect(DEFAULT_NAV_ORDER.slice(0, 2)).toEqual(['workspace', 'git'])
    expect(DEFAULT_NAV_ORDER.indexOf('overview')).toBe(DEFAULT_NAV_ORDER.indexOf('settings') - 1)
  })

  it('fills missing ids and drops unknowns', () => {
    expect(normalizeNavOrder(undefined)).toEqual(DEFAULT_NAV_ORDER)
    expect(normalizeNavOrder(['settings', 'ghost', 'workspace'])).toEqual([
      'settings',
      'workspace',
      ...NAV_ITEM_IDS.filter((id) => id !== 'settings' && id !== 'workspace')
    ])
  })

  it('dedupes while preserving the first occurrence', () => {
    expect(normalizeNavOrder(['models', 'models', 'overview'])[0]).toBe('models')
    expect(
      normalizeNavOrder(['models', 'models', 'overview']).filter((id) => id === 'models')
    ).toHaveLength(1)
  })

  it('moves an item within bounds and no-ops otherwise', () => {
    const order = [...NAV_ITEM_IDS]
    expect(moveNavItem(order, 0, 1)[0]).toBe('git')
    expect(moveNavItem(order, 0, 1)[1]).toBe('workspace')
    expect(moveNavItem(order, 0, 0)).toEqual(order)
    expect(moveNavItem(order, -1, 1)).toEqual(order)
    expect(moveNavItem(order, 0, 99)).toEqual(order)
  })
})
