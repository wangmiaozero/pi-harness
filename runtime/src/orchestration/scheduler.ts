/**
 * Task Scheduler.
 *
 * Deterministic dispatch planning over the task graph. Strategies: manual
 * (user starts each task), sequential (one task at a time in order) and
 * dependency-based (ready tasks dispatch, parallel up to the ceilings). No
 * AI planning — this is pure scheduling over declared state.
 */

import type {
  HarnessOrchestrationRun,
  HarnessTask,
  HarnessTaskPriority
} from '../harness-control/types.js'
import { resolveDependencies } from './dependency-resolver.js'

export interface DispatchCandidate {
  task: HarnessTask
  agentId: string
}

export interface SchedulingSnapshot {
  readyTaskIds: string[]
  blocked: Array<{ taskId: string; unmet: string[] }>
  /** Agents currently executing a run. */
  runningAgentIds: string[]
  /** Sessions with a run in flight. */
  runningRunCount: number
  maxConcurrentAgents: number
  maxConcurrentRuns: number
}

const PRIORITY_WEIGHT: Record<HarnessTaskPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1
}

export class TaskScheduler {
  /**
   * Pick tasks to dispatch now under the orchestration strategy and the
   * concurrency ceilings. Returns (task, agent) candidates in dispatch order.
   */
  plan(
    orchestration: HarnessOrchestrationRun,
    tasks: readonly HarnessTask[],
    snapshot: SchedulingSnapshot
  ): DispatchCandidate[] {
    if (orchestration.status !== 'running') return []
    const { ready, blocked } = resolveDependencies(tasks)
    void blocked

    const readyTasks = tasks.filter((task) => ready.includes(task.id))
    if (!readyTasks.length) return []

    if (orchestration.strategy === 'sequential') {
      const ordered = [...readyTasks].sort(
        (a, b) =>
          PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
          a.createdAt - b.createdAt
      )
      if (snapshot.runningRunCount >= 1) return []
      const first = ordered[0]
      if (!first) return []
      const agentId = first.assignedAgentId
      return agentId ? [{ task: first, agentId }] : []
    }

    if (orchestration.strategy === 'manual') {
      // Manual tasks are dispatched only via explicit user action.
      return []
    }

    // dependency-based: dispatch ready tasks, priority first, respecting
    // both concurrency ceilings and one-run-per-agent at a time.
    const ordered = [...readyTasks].sort(
      (a, b) =>
        PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
        a.createdAt - b.createdAt
    )
    const candidates: DispatchCandidate[] = []
    const runningAgents = new Set(snapshot.runningAgentIds)
    let runSlots = Math.max(
      0,
      orchestration.maxConcurrentRuns - snapshot.runningRunCount
    )
    for (const task of ordered) {
      if (runSlots <= 0) break
      if (runningAgents.size >= orchestration.maxConcurrentAgents) break
      const agentId = task.assignedAgentId
      if (!agentId) continue
      if (runningAgents.has(agentId)) continue
      candidates.push({ task, agentId })
      runningAgents.add(agentId)
      runSlots -= 1
    }
    return candidates
  }

  /** Compute what the task statuses should be, derived — never hand-set. */
  deriveStatuses(tasks: readonly HarnessTask[]): Map<string, HarnessTask['status']> {
    const { blocked, ready } = resolveDependencies(tasks)
    const blockedIds = new Map(blocked.map((item) => [item.taskId, item.unmet]))
    const next = new Map<string, HarnessTask['status']>()
    for (const task of tasks) {
      // Only pending / blocked states are derived here; running, verifying,
      // review, completed, failed and cancelled are runtime-driven.
      if (task.status === 'pending') {
        next.set(task.id, blockedIds.has(task.id) ? 'blocked' : 'ready')
        continue
      }
      if (task.status === 'blocked' && !blockedIds.has(task.id)) {
        next.set(task.id, 'ready')
      }
    }
    void ready
    return next
  }
}
