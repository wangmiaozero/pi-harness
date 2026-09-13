/**
 * Dependency Resolver.
 *
 * Deterministic dependency math over HarnessTasks: cycle detection, blocked /
 * ready computation and topological layers. Pure functions — no scheduling
 * side effects live here.
 */

import type { HarnessTask, HarnessTaskStatus } from '@shared/types/harness'

export interface DependencyCycle {
  cycle: string[]
}

export interface DependencyResolution {
  /** Task ids that form one or more dependency cycles (empty when acyclic). */
  cycles: string[][]
  /** Tasks whose dependencies are not all terminal — and why. */
  blocked: Array<{ taskId: string; unmet: string[] }>
  /** Tasks free to start: pending, dependencies satisfied. */
  ready: string[]
  /** Layers of tasks that can run in parallel, in dependency order. */
  layers: string[][]
}

const TERMINAL_STATUSES: ReadonlySet<HarnessTaskStatus> = new Set(['completed', 'cancelled'])
/** Statuses that never satisfy a dependency and never will without a retry. */
const UNRESOLVABLE_STATUSES: ReadonlySet<HarnessTaskStatus> = new Set(['failed'])
/** Task statuses eligible for dispatch. */
const DISPATCHABLE_STATUSES: ReadonlySet<HarnessTaskStatus> = new Set(['pending', 'ready'])

export function detectCycles(tasks: readonly HarnessTask[]): string[][] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const cycles: string[][] = []
  const stack: string[] = []

  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return
    if (visiting.has(taskId)) {
      const start = stack.indexOf(taskId)
      if (start >= 0) cycles.push([...stack.slice(start), taskId])
      return
    }
    const task = byId.get(taskId)
    if (!task) return
    visiting.add(taskId)
    stack.push(taskId)
    for (const dependency of task.dependencies) {
      if (byId.has(dependency)) visit(dependency)
    }
    stack.pop()
    visiting.delete(taskId)
    visited.add(taskId)
  }

  for (const task of tasks) visit(task.id)
  return cycles
}

export function resolveDependencies(tasks: readonly HarnessTask[]): DependencyResolution {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const cycles = detectCycles(tasks)
  const cycleIds = new Set(cycles.flat())

  const blocked: DependencyResolution['blocked'] = []
  const ready: string[] = []

  for (const task of tasks) {
    if (cycleIds.has(task.id)) {
      blocked.push({ taskId: task.id, unmet: ['cycle'] })
      continue
    }
    if (!DISPATCHABLE_STATUSES.has(task.status)) continue
    const unmet = task.dependencies
      .filter((dependency) => {
        const dep = byId.get(dependency)
        if (!dep) return true
        return !TERMINAL_STATUSES.has(dep.status)
      })
      .map((dependency) => (byId.has(dependency) ? dependency : `${dependency} (missing)`))
    if (unmet.length) {
      blocked.push({ taskId: task.id, unmet })
    } else {
      ready.push(task.id)
    }
  }

  return { cycles, blocked, ready, layers: topologicalLayers(tasks) }
}

/** Tasks grouped into parallel waves; cycle members are excluded. */
export function topologicalLayers(tasks: readonly HarnessTask[]): string[][] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const cycles = detectCycles(tasks)
  const cycleIds = new Set(cycles.flat())
  const remaining = new Set(
    tasks.filter((task) => !cycleIds.has(task.id)).map((task) => task.id)
  )
  const layers: string[][] = []
  const placed = new Set<string>()

  while (remaining.size) {
    const layer: string[] = []
    for (const taskId of remaining) {
      const task = byId.get(taskId)
      if (!task) continue
      const satisfied = task.dependencies.every(
        (dependency) =>
          !byId.has(dependency) ||
          placed.has(dependency) ||
          TERMINAL_STATUSES.has(byId.get(dependency)!.status)
      )
      if (satisfied) layer.push(taskId)
    }
    if (!layer.length) {
      // Defensive: should not happen after cycle exclusion.
      layer.push(...remaining)
    }
    for (const taskId of layer) {
      remaining.delete(taskId)
      placed.add(taskId)
    }
    layers.push(layer)
  }
  return layers
}

/** Tasks that (transitively) depend on the given task. */
export function dependentsOf(taskId: string, tasks: readonly HarnessTask[]): string[] {
  const children = new Map<string, string[]>()
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      const list = children.get(dependency) ?? []
      list.push(task.id)
      children.set(dependency, list)
    }
  }
  const seen = new Set<string>()
  const queue = [taskId]
  while (queue.length) {
    const current = queue.shift()!
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      queue.push(child)
    }
  }
  return [...seen]
}

export function isUnresolvable(task: HarnessTask): boolean {
  return UNRESOLVABLE_STATUSES.has(task.status)
}

/** Simple depth for rendering a dependency outline (longest chain upward). */
export function dependencyDepth(taskId: string, tasks: readonly HarnessTask[]): number {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const depthOf = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0
    const task = byId.get(id)
    if (!task?.dependencies.length) return 0
    seen.add(id)
    return 1 + Math.max(0, ...task.dependencies.map((dep) => depthOf(dep, seen)))
  }
  return depthOf(taskId, new Set())
}
