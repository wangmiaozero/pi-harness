import type { GitCommitInfo } from '../types/workspace'

export interface GitGraphEdge {
  lane: number
  color: number
}

export interface GitGraphRow {
  commit: GitCommitInfo
  column: number
  columnColor: number
  passThrough: GitGraphEdge[]
  mergeSources: GitGraphEdge[]
  parentLanes: GitGraphEdge[]
  laneCount: number
}

export function layoutGitGraph(commits: GitCommitInfo[]): GitGraphRow[] {
  const lanes: Array<string | null> = []
  const laneColors: number[] = []
  let nextColor = 0

  function allocateLane(hash: string | null, color: number): number {
    const free = lanes.findIndex((lane) => lane === null)
    if (free >= 0) {
      lanes[free] = hash
      laneColors[free] = color
      return free
    }
    lanes.push(hash)
    laneColors.push(color)
    return lanes.length - 1
  }

  return commits.map((commit) => {
    const matching = lanes.flatMap((hash, lane) => (hash === commit.hash ? [lane] : []))
    const columnColor = matching.length ? laneColors[matching[0]!]! : nextColor++
    const column = matching.length ? matching[0]! : allocateLane(null, columnColor)
    const mergeSources = matching.map((lane) => ({ lane, color: laneColors[lane]! }))
    const passThrough = lanes.flatMap((hash, lane) =>
      hash !== null && !matching.includes(lane) ? [{ lane, color: laneColors[lane]! }] : []
    )

    for (const lane of matching) lanes[lane] = null

    const parentLanes: GitGraphEdge[] = []
    commit.parents.forEach((parent, index) => {
      if (index === 0) {
        lanes[column] = parent
        laneColors[column] = columnColor
        parentLanes.push({ lane: column, color: columnColor })
        return
      }
      const existing = lanes.indexOf(parent)
      if (existing >= 0) {
        parentLanes.push({ lane: existing, color: laneColors[existing]! })
        return
      }
      const color = nextColor++
      parentLanes.push({ lane: allocateLane(parent, color), color })
    })

    const usedLanes = [
      column,
      ...passThrough.map((edge) => edge.lane),
      ...mergeSources.map((edge) => edge.lane),
      ...parentLanes.map((edge) => edge.lane)
    ]
    return {
      commit,
      column,
      columnColor,
      passThrough,
      mergeSources,
      parentLanes,
      laneCount: Math.max(1, ...usedLanes.map((lane) => lane + 1))
    }
  })
}
