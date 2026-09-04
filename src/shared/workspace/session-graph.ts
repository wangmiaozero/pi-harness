import type { HarnessSessionEntry } from '../types/harness'

export interface SessionGraphEdge {
  lane: number
  color: number
}

export interface SessionGraphRow {
  entry: HarnessSessionEntry
  column: number
  columnColor: number
  /** Lanes passing vertically through this row without touching the node. */
  passThrough: SessionGraphEdge[]
  /** Lanes feeding into this row's node from above. */
  inboundLanes: SessionGraphEdge[]
  /** Lanes leaving this node toward its children below. */
  childLanes: SessionGraphEdge[]
  laneCount: number
}

/**
 * Lay out Pi Session Tree entries in a git-graph style: the active path stays
 * on the trunk lane, while forked siblings split off into side lanes.
 *
 * The algorithm mirrors `layoutGitGraph`: lanes carry the id of the child
 * expected to arrive next on them. The active child (falling back to the first
 * child) inherits its parent's lane so the current conversation position reads
 * as a straight trunk; every other child is allocated a new colored lane.
 */
export function layoutSessionTree(entries: HarnessSessionEntry[]): SessionGraphRow[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const childrenOf = new Map<string, HarnessSessionEntry[]>()
  for (const entry of entries) {
    if (!entry.parentId || !byId.has(entry.parentId)) continue
    const siblings = childrenOf.get(entry.parentId)
    if (siblings) siblings.push(entry)
    else childrenOf.set(entry.parentId, [entry])
  }

  const lanes: Array<string | null> = []
  const laneColors: number[] = []
  let nextColor = 0

  function allocateLane(reservedId: string | null, color: number): number {
    const free = lanes.findIndex((lane) => lane === null)
    if (free >= 0) {
      lanes[free] = reservedId
      laneColors[free] = color
      return free
    }
    lanes.push(reservedId)
    laneColors.push(color)
    return lanes.length - 1
  }

  return entries.map((entry) => {
    const matching = lanes.flatMap((id, lane) => (id === entry.id ? [lane] : []))
    const columnColor = matching.length ? laneColors[matching[0]!]! : nextColor++
    const column = matching.length ? matching[0]! : allocateLane(null, columnColor)
    const inboundLanes = matching.map((lane) => ({ lane, color: laneColors[lane]! }))
    const passThrough = lanes.flatMap((id, lane) =>
      id !== null && !matching.includes(lane) ? [{ lane, color: laneColors[lane]! }] : []
    )

    for (const lane of matching) lanes[lane] = null

    const childLanes: SessionGraphEdge[] = []
    const children = childrenOf.get(entry.id) ?? []
    const primary = children.find((child) => child.active) ?? children[0]
    // Reserve the trunk lane for the primary child before allocating side
    // lanes, so branch children can never steal the trunk slot.
    if (primary) {
      lanes[column] = primary.id
      laneColors[column] = columnColor
      childLanes.push({ lane: column, color: columnColor })
    }
    for (const child of children) {
      if (child === primary) continue
      const color = nextColor++
      childLanes.push({ lane: allocateLane(child.id, color), color })
    }

    const usedLanes = [
      column,
      ...passThrough.map((edge) => edge.lane),
      ...inboundLanes.map((edge) => edge.lane),
      ...childLanes.map((edge) => edge.lane)
    ]
    return {
      entry,
      column,
      columnColor,
      passThrough,
      inboundLanes,
      childLanes,
      laneCount: Math.max(1, ...usedLanes.map((lane) => lane + 1))
    }
  })
}
