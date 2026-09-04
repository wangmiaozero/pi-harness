import { describe, expect, it } from 'vitest'
import { layoutSessionTree } from './session-graph'
import type { HarnessSessionEntry } from '../types/harness'

function entry(
  id: string,
  parentId: string | null,
  active = false,
  overrides: Partial<HarnessSessionEntry> = {}
): HarnessSessionEntry {
  return { id, parentId, type: 'message', active, ...overrides }
}

describe('layoutSessionTree', () => {
  it('keeps a linear conversation on a single trunk lane', () => {
    const rows = layoutSessionTree([
      entry('a', null, true),
      entry('b', 'a', true),
      entry('c', 'b', true)
    ])

    expect(rows.map((row) => row.column)).toEqual([0, 0, 0])
    expect(rows.every((row) => row.laneCount === 1)).toBe(true)
    expect(rows.every((row) => row.passThrough.length === 0)).toBe(true)
    expect(rows[0]!.childLanes).toEqual([{ lane: 0, color: rows[0]!.columnColor }])
  })

  it('sends inactive forked siblings to their own colored lane', () => {
    const rows = layoutSessionTree([
      entry('root', null, true),
      entry('active-child', 'root', true),
      entry('fork', 'root', false),
      entry('grandchild', 'fork', false)
    ])

    const [root, activeChild, fork, grandchild] = rows
    expect(root!.column).toBe(0)
    // The active child keeps the trunk; the fork branches into lane 1.
    expect(root!.childLanes.map((edge) => edge.lane)).toEqual([0, 1])
    expect(root!.laneCount).toBe(2)
    expect(activeChild!.column).toBe(0)
    // Lane 1 passes through the active child's row.
    expect(activeChild!.passThrough.map((edge) => edge.lane)).toEqual([1])
    expect(fork!.column).toBe(1)
    expect(fork!.inboundLanes.map((edge) => edge.lane)).toEqual([1])
    expect(grandchild!.column).toBe(1)
    expect(grandchild!.passThrough).toHaveLength(0)
  })

  it('prefers the active child as trunk even when it arrives last', () => {
    const rows = layoutSessionTree([
      entry('root', null, true),
      entry('stale', 'root', false),
      entry('current', 'root', true)
    ])

    expect(rows[0]!.childLanes.map((edge) => edge.lane)).toEqual([0, 1])
    expect(rows[1]!.column).toBe(1)
    expect(rows[2]!.column).toBe(0)
  })

  it('treats entries with unknown parents as roots', () => {
    const rows = layoutSessionTree([entry('orphan', 'missing', false)])

    expect(rows).toHaveLength(1)
    expect(rows[0]!.column).toBe(0)
    expect(rows[0]!.inboundLanes).toHaveLength(0)
    expect(rows[0]!.childLanes).toHaveLength(0)
  })

  it('handles an empty tree', () => {
    expect(layoutSessionTree([])).toEqual([])
  })
})
