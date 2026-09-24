import { describe, expect, it } from 'vitest'
import type { HarnessOrchestrationRun, HarnessTask } from '@shared/types/harness'
import { TaskScheduler } from './task-scheduler'

function task(id: string, overrides: Partial<HarnessTask> = {}): HarnessTask {
  return {
    id,
    orchestrationId: 'orch',
    projectId: null,
    title: id,
    description: null,
    status: 'pending',
    priority: 'normal',
    assignedAgentId: 'agent-x',
    parentTaskId: null,
    dependencies: [],
    inputArtifactIds: [],
    runIds: [],
    artifactIds: [],
    lastRunId: null,
    retryCount: 0,
    reviewRequired: false,
    reviewAgentId: null,
    reviewVerdict: null,
    reviewSummary: null,
    error: null,
    createdAt: 1,
    startedAt: null,
    finishedAt: null,
    ...overrides
  }
}

function orchestration(overrides: Partial<HarnessOrchestrationRun> = {}): HarnessOrchestrationRun {
  return {
    id: 'orch',
    name: null,
    status: 'running',
    strategy: 'dependency',
    cwd: '/repo',
    taskIds: [],
    agentIds: [],
    maxConcurrentAgents: 3,
    maxConcurrentRuns: 3,
    budget: { maxCost: null, maxTokens: null },
    startedAt: 1,
    finishedAt: null,
    totalTokens: 0,
    estimatedCost: null,
    successCount: 0,
    failureCount: 0,
    pausedReason: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function snapshot(overrides: Partial<Parameters<TaskScheduler['plan']>[2]> = {}) {
  return {
    readyTaskIds: [],
    blocked: [],
    runningAgentIds: [],
    runningRunCount: 0,
    maxConcurrentAgents: 3,
    maxConcurrentRuns: 3,
    ...overrides
  }
}

const scheduler = new TaskScheduler()

describe('TaskScheduler.plan', () => {
  it('returns nothing unless the orchestration is running', () => {
    const tasks = [task('a')]
    expect(scheduler.plan(orchestration({ status: 'paused' }), tasks, snapshot())).toEqual([])
    expect(scheduler.plan(orchestration({ status: 'completed' }), tasks, snapshot())).toEqual([])
  })

  it('dispatches only ready tasks with an assigned agent', () => {
    const tasks = [
      task('a'),
      task('no-agent', { assignedAgentId: null }),
      task('blocked', { dependencies: ['a'] })
    ]
    const plan = scheduler.plan(orchestration(), tasks, snapshot())
    expect(plan.map((item) => item.task.id)).toEqual(['a'])
  })

  it('respects the run concurrency ceiling', () => {
    const tasks = [task('a'), task('b'), task('c')]
    const plan = scheduler.plan(
      orchestration({ maxConcurrentRuns: 2 }),
      tasks,
      snapshot({ runningRunCount: 1 })
    )
    expect(plan).toHaveLength(1)
  })

  it('never double-books a running agent', () => {
    const tasks = [task('a'), task('b')]
    const plan = scheduler.plan(
      orchestration(),
      tasks,
      snapshot({ runningAgentIds: ['agent-x'], runningRunCount: 0 })
    )
    expect(plan).toEqual([])
  })

  it('orders critical before normal, then creation time', () => {
    const tasks = [
      task('normal-1', { createdAt: 10, assignedAgentId: 'agent-1' }),
      task('critical', { priority: 'critical', createdAt: 30, assignedAgentId: 'agent-2' }),
      task('normal-2', { createdAt: 20, assignedAgentId: 'agent-3' })
    ]
    const plan = scheduler.plan(orchestration(), tasks, snapshot())
    expect(plan.map((item) => item.task.id)).toEqual(['critical', 'normal-1', 'normal-2'])
  })

  it('sequential strategy dispatches one task at a time', () => {
    const tasks = [task('a'), task('b')]
    const busy = scheduler.plan(
      orchestration({ strategy: 'sequential' }),
      tasks,
      snapshot({ runningRunCount: 1 })
    )
    expect(busy).toEqual([])
    const idle = scheduler.plan(orchestration({ strategy: 'sequential' }), tasks, snapshot())
    expect(idle).toHaveLength(1)
    expect(idle[0].task.id).toBe('a')
  })

  it('manual strategy never auto-dispatches', () => {
    const tasks = [task('a')]
    expect(scheduler.plan(orchestration({ strategy: 'manual' }), tasks, snapshot())).toEqual([])
  })
})

describe('TaskScheduler.deriveStatuses', () => {
  it('derives pending → ready / blocked', () => {
    const tasks = [task('a'), task('b', { dependencies: ['a'] }), task('c', { status: 'running' })]
    const derived = scheduler.deriveStatuses(tasks)
    expect(derived.get('a')).toBe('ready')
    expect(derived.get('b')).toBe('blocked')
    expect(derived.has('c')).toBe(false)
  })

  it('unblocks previously blocked tasks when dependencies complete', () => {
    const tasks = [
      task('a', { status: 'completed' }),
      task('b', { dependencies: ['a'], status: 'blocked' })
    ]
    const derived = scheduler.deriveStatuses(tasks)
    expect(derived.get('b')).toBe('ready')
  })

  it('leaves runtime-driven statuses untouched', () => {
    const tasks = [task('a', { status: 'verifying' }), task('b', { status: 'completed' })]
    expect(scheduler.deriveStatuses(tasks).size).toBe(0)
  })
})
