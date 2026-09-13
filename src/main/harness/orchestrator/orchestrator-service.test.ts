import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  HarnessArtifact,
  HarnessEvent,
  HarnessEventEnvelope,
  HarnessRun
} from '@shared/types/harness'
import type { StartAgentSessionInput } from '@shared/types/workspace'
import type { RunRelationAnnotation } from '../runs/run-registry'
import { JsonStore } from '../../services/storage'
import {
  EMPTY_ORCHESTRATION_STORE,
  OrchestrationStore,
  type OrchestrationStoreRecord
} from './orchestration-store'
import {
  OrchestratorService,
  type CreateTaskInput,
  type OrchestratorHost
} from './orchestrator-service'

const tempDirs: string[] = []
let activeHarness: Harness | null = null

afterEach(async () => {
  if (activeHarness) {
    await activeHarness.service.waitForSettled()
    activeHarness.service.detach()
    activeHarness = null
  }
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

interface DispatchedPrompt {
  sessionId: string
  message: string
  runId: string
}

/** Fake runtime host — the orchestrator runs against this seam in tests. */
export class FakeHost implements OrchestratorHost {
  private readonly listeners = new Set<(payload: HarnessEventEnvelope) => void>()
  private readonly runs = new Map<string, HarnessRun>()
  private readonly artifactsByTask = new Map<string, HarnessArtifact[]>()
  private readonly pendingAnnotations = new Map<string, RunRelationAnnotation>()
  readonly prompts: DispatchedPrompt[] = []
  readonly annotations: Array<{ sessionId: string; annotation: RunRelationAnnotation }> = []
  readonly startedSessions: StartAgentSessionInput[] = []
  private sessionCounter = 0
  private runCounter = 0

  subscribe(listener: (payload: HarnessEventEnvelope) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  deliver(sessionId: string, event: HarnessEvent): void {
    for (const listener of this.listeners) listener({ sessionId, event })
  }

  async startSession(input: StartAgentSessionInput) {
    this.sessionCounter += 1
    this.startedSessions.push(input)
    return { sessionId: `sess-${this.sessionCounter}`, cwd: input.cwd ?? '/repo' }
  }

  async prompt(sessionId: string, message: string) {
    this.runCounter += 1
    const runId = `run-${this.runCounter}`
    this.prompts.push({ sessionId, message, runId })
    // Mirror the real runtime: the next run of the session carries the
    // relation annotation (agentId / taskId / orchestrationId / retry).
    const annotation = this.pendingAnnotations.get(sessionId)
    this.pendingAnnotations.delete(sessionId)
    this.runs.set(
      runId,
      makeRun(runId, sessionId, {
        agentId: annotation?.agentId ?? null,
        taskId: annotation?.taskId ?? null,
        orchestrationId: annotation?.orchestrationId ?? null,
        relation: annotation?.relation ?? 'original',
        forkedFromRunId: annotation?.forkedFromRunId ?? null
      })
    )
    // Real runtime: run.started is delivered synchronously during prompt.
    this.deliver(sessionId, {
      type: 'run.started',
      timestamp: Date.now(),
      runId,
      prompt: message
    })
    return { runId }
  }

  async abortSession(sessionId: string): Promise<void> {
    // Real runtime: aborting settles the in-flight run with run.aborted.
    for (const run of [...this.runs.values()]) {
      if (run.sessionId === sessionId && run.status === 'running') {
        this.seedRun(run.id, { status: 'aborted' })
        this.deliver(sessionId, { type: 'run.aborted', timestamp: Date.now(), runId: run.id })
      }
    }
  }

  annotateNextRun(sessionId: string, annotation: RunRelationAnnotation): void {
    this.annotations.push({ sessionId, annotation })
    this.pendingAnnotations.set(sessionId, annotation)
  }

  async setSessionName(): Promise<void> {}
  emitOrchestrationEvent(): void {}
  getOrchestrationTimeline(): HarnessEvent[] {
    return []
  }

  async getRunById(runId: string): Promise<HarnessRun | null> {
    return this.runs.get(runId) ?? null
  }

  async listRunsByOrchestration(orchestrationId: string): Promise<HarnessRun[]> {
    return [...this.runs.values()].filter((run) => run.orchestrationId === orchestrationId)
  }

  async getArtifact(artifactId: string): Promise<HarnessArtifact | null> {
    for (const list of this.artifactsByTask.values()) {
      const found = list.find((artifact) => artifact.id === artifactId)
      if (found) return found
    }
    return null
  }

  async artifactsForTask(taskId: string): Promise<HarnessArtifact[]> {
    return this.artifactsByTask.get(taskId) ?? []
  }

  async artifactsForAgent(agentId: string): Promise<HarnessArtifact[]> {
    const all = [...this.artifactsByTask.values()].flat()
    return all.filter((artifact) => artifact.producedByAgentId === agentId)
  }

  async markArtifactsConsumed(): Promise<void> {}
  async bindAgentSession(): Promise<void> {}

  async createWorktree(cwd: string, branch: string) {
    return { path: `${cwd}/../wt-${branch}`, branch }
  }

  // --- test helpers -------------------------------------------------------

  /** Fill the run a prompt created (status, result, usage, agent/task/orch ids). */
  seedRun(runId: string, overrides: Partial<HarnessRun>): HarnessRun {
    const current = this.runs.get(runId)
    const next = { ...current, ...overrides } as HarnessRun
    this.runs.set(runId, next)
    return next
  }

  seedTaskArtifacts(taskId: string, artifacts: HarnessArtifact[]): void {
    this.artifactsByTask.set(taskId, [
      ...(this.artifactsByTask.get(taskId) ?? []),
      ...artifacts
    ])
  }

  /** Simulate the runtime settling a run (evaluation + verdict events). */
  settleRun(
    sessionId: string,
    runId: string,
    options: {
      result?: string
      status?: 'success' | 'failed' | 'aborted'
      evaluation?: 'passed' | 'warning' | 'failed'
      error?: string
    } = {}
  ): void {
    this.seedRun(runId, {
      result: options.result ?? null,
      error: options.error ?? null,
      status: options.status ?? 'success'
    })
    if (options.evaluation) {
      this.deliver(sessionId, { type: 'evaluation.started', timestamp: Date.now(), runId })
      this.deliver(sessionId, {
        type: 'evaluation.completed',
        timestamp: Date.now(),
        runId,
        status: options.evaluation
      })
    }
    if ((options.status ?? 'success') === 'success') {
      this.deliver(sessionId, {
        type: 'run.completed',
        timestamp: Date.now(),
        runId,
        status: 'success'
      })
    } else if (options.status === 'failed') {
      this.deliver(sessionId, {
        type: 'run.failed',
        timestamp: Date.now(),
        runId,
        ...(options.error ? { error: options.error } : {})
      })
    } else {
      this.deliver(sessionId, { type: 'run.aborted', timestamp: Date.now(), runId })
    }
  }
}

function makeRun(runId: string, sessionId: string, overrides: Partial<HarnessRun> = {}): HarnessRun {
  return {
    id: runId,
    sessionId,
    parentRunId: null,
    relation: 'original',
    forkedFromRunId: null,
    forkedFromEventId: null,
    forkedFromCheckpointId: null,
    status: 'running',
    source: 'live',
    anchorEntryId: null,
    cwd: '/repo',
    agentId: null,
    taskId: null,
    orchestrationId: null,
    startedAt: Date.now(),
    finishedAt: null,
    model: null,
    provider: null,
    prompt: 'orchestrated',
    usage: {
      inputTokens: 100,
      outputTokens: 100,
      cachedTokens: 0,
      totalTokens: 200,
      estimatedCost: 0.01
    },
    toolCallCount: 0,
    toolFailureCount: 0,
    contextUsage: null,
    result: null,
    error: null,
    budgetExceeded: null,
    steps: [],
    checkpointIds: [],
    ...overrides
  }
}

function makeArtifact(id: string, overrides: Partial<HarnessArtifact> = {}): HarnessArtifact {
  return {
    id,
    runId: 'run-1',
    sessionId: 'sess-1',
    sourceEventId: 'event-1',
    type: 'file',
    name: `${id}.ts`,
    path: `/repo/src/${id}.ts`,
    createdAt: Date.now(),
    producedByAgentId: null,
    producedByTaskId: null,
    consumedByAgentIds: [],
    consumedByTaskIds: [],
    metadata: {},
    ...overrides
  }
}

interface Harness {
  service: OrchestratorService
  host: FakeHost
  store: OrchestrationStore
}

function createHarness(): Harness {
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-orch-test-'))
  tempDirs.push(dir)
  const jsonStore = new JsonStore<OrchestrationStoreRecord>(
    path.join(dir, 'orchestration.json'),
    EMPTY_ORCHESTRATION_STORE
  )
  const store = new OrchestrationStore(jsonStore)
  const host = new FakeHost()
  const service = new OrchestratorService(store, host)
  service.attach()
  activeHarness = { service, host, store }
  return activeHarness
}

async function bootstrapOrchestration(
  harness: Harness,
  options: {
    agents?: Array<{
      name: string
      role: string
      isReviewer?: boolean
      budget?: { maxCost: number | null; maxTokens: number | null }
    }>
    tasks?: Array<Partial<CreateTaskInput> & { key: string; dependencies?: string[] }>
    orchestration?: {
      strategy?: 'manual' | 'sequential' | 'dependency'
      budget?: { maxCost: number | null; maxTokens: number | null }
    }
  } = {}
): Promise<{ orchestrationId: string; agentIds: Record<string, string>; taskIds: Record<string, string> }> {
  const orchestration = await harness.service.createOrchestration({
    name: 'Test orchestration',
    cwd: '/repo',
    strategy: options.orchestration?.strategy ?? 'dependency',
    budget: options.orchestration?.budget ?? { maxCost: null, maxTokens: null }
  })
  const agentIds: Record<string, string> = {}
  for (const agent of options.agents ?? []) {
    const created = await harness.service.addAgent(orchestration.id, {
      name: agent.name,
      role: agent.role,
      description: null,
      provider: null,
      modelId: null,
      thinkingLevel: null,
      toolNames: null,
      skillIds: [],
      workspaceMode: 'shared',
      isReviewer: agent.isReviewer ?? false,
      budget: agent.budget ?? { maxCost: null, maxTokens: null }
    })
    agentIds[agent.name] = created.id
  }
  const taskIds: Record<string, string> = {}
  for (const task of options.tasks ?? []) {
    const created = await harness.service.createTask({
      orchestrationId: orchestration.id,
      title: task.title ?? task.key,
      description: task.description ?? null,
      priority: task.priority ?? 'normal',
      assignedAgentId: task.assignedAgentId ?? null,
      parentTaskId: null,
      dependencies: [],
      inputArtifactIds: [],
      reviewRequired: task.reviewRequired ?? false
    })
    taskIds[task.key] = created.id
  }
  // Second pass — dependencies reference task ids assigned after creation.
  for (const task of options.tasks ?? []) {
    if (task.dependencies?.length) {
      await harness.service.updateTask(taskIds[task.key], {
        dependencies: task.dependencies.map((key) => taskIds[key])
      })
    }
  }
  return { orchestrationId: orchestration.id, agentIds, taskIds }
}

describe('OrchestratorService lifecycle', () => {
  it('creates an orchestration with defaults and persists it', async () => {
    const harness = createHarness()
    const orchestration = await harness.service.createOrchestration({
      name: 'Release prep',
      cwd: '/repo'
    })
    expect(orchestration.status).toBe('pending')
    expect(orchestration.strategy).toBe('dependency')
    expect(orchestration.budget).toEqual({ maxCost: null, maxTokens: null })

    const listed = await harness.service.listOrchestrations()
    expect(listed.map((item) => item.id)).toContain(orchestration.id)

    await harness.service.deleteOrchestration(orchestration.id)
    expect((await harness.service.listOrchestrations()).map((item) => item.id)).not.toContain(
      orchestration.id
    )
  })

  it('seeds builtin team presets', async () => {
    const harness = createHarness()
    await harness.service.ensureBuiltinPresets()
    const teams = await harness.service.listTeams()
    expect(teams.map((team) => team.name)).toEqual(
      expect.arrayContaining(['Solo', 'Developer + Reviewer'])
    )
    const templates = await harness.service.listTemplates()
    expect(templates.map((template) => template.role)).toEqual(
      expect.arrayContaining(['architect', 'frontend', 'backend', 'qa', 'reviewer'])
    )
  })

  it('rejects task graphs with missing or cyclic dependencies', async () => {
    const harness = createHarness()
    const { orchestrationId } = await bootstrapOrchestration(harness)
    await expect(
      harness.service.createTask({
        orchestrationId,
        title: 'Ghost dep',
        dependencies: ['task-missing']
      })
    ).rejects.toThrow(/missing/i)

    const a = await harness.service.createTask({ orchestrationId, title: 'A' })
    const b = await harness.service.createTask({ orchestrationId, title: 'B' })
    await harness.service.updateTask(a.id, { dependencies: [b.id] })
    await expect(harness.service.updateTask(b.id, { dependencies: [a.id] })).rejects.toThrow(
      /cycle/i
    )
  })
})

describe('OrchestratorService dispatch', () => {
  it('runs a dependency chain end-to-end and completes the orchestration', async () => {
    const harness = createHarness()
    const { orchestrationId, agentIds } = await bootstrapOrchestration(harness, {
      agents: [{ name: 'Dev', role: 'backend' }],
      tasks: [
        { key: 'design', assignedAgentId: null },
        { key: 'build', assignedAgentId: null, dependencies: ['design'] }
      ]
    })
    await harness.service.reassignTask(
      (await harness.service.listTasks(orchestrationId)).find((task) => task.title === 'design')!
        .id,
      agentIds['Dev']
    )
    // Assign build after creation to keep the graph valid.
    const tasks = await harness.service.listTasks(orchestrationId)
    await harness.service.reassignTask(
      tasks.find((task) => task.title === 'build')!.id,
      agentIds['Dev']
    )

    await harness.service.start(orchestrationId)

    // First dispatch: only the ready task.
    expect(harness.host.prompts).toHaveLength(1)
    expect(harness.host.prompts[0].message).toContain('## Your task')
    expect(harness.host.prompts[0].message).toContain('design')

    const running = (await harness.service.listTasks(orchestrationId)).find(
      (task) => task.title === 'design'
    )!
    expect(running.status).toBe('running')

    // Complete the run — the dependent task must dispatch next.
    harness.host.settleRun(harness.host.prompts[0].sessionId, harness.host.prompts[0].runId, {
      result: 'API design finished'
    })
    await vi.waitFor(async () => {
      expect(harness.host.prompts).toHaveLength(2)
    }, 5000)
    expect(harness.host.prompts[1].message).toContain('build')
    // Dependency evidence flows into the next agent's context.
    expect(harness.host.prompts[1].message).toContain('API design finished')

    harness.host.settleRun(harness.host.prompts[1].sessionId, harness.host.prompts[1].runId, {
      result: 'Implemented'
    })
    // Completion flips the orchestration and persists the final evaluation.
    const finalTasks = await vi.waitFor(async () => {
      const orchestration = await harness.service.getOrchestration(orchestrationId)
      expect(orchestration?.status).toBe('completed')
      const evaluation = await harness.store.getEvaluation(orchestrationId)
      expect(evaluation?.status).toBe('passed')
      return harness.service.listTasks(orchestrationId)
    }, 5000)
    expect(finalTasks.every((task) => task.status === 'completed')).toBe(true)
  })

  it('records handoffs when a dependent task consumes upstream artifacts', async () => {
    const harness = createHarness()
    const { orchestrationId, agentIds } = await bootstrapOrchestration(harness, {
      agents: [
        { name: 'Architect', role: 'architect' },
        { name: 'Dev', role: 'backend' }
      ],
      tasks: [
        { key: 'design', assignedAgentId: null },
        { key: 'build', assignedAgentId: null, dependencies: ['design'] }
      ]
    })
    const tasks = await harness.service.listTasks(orchestrationId)
    await harness.service.reassignTask(
      tasks.find((task) => task.title === 'design')!.id,
      agentIds['Architect']
    )
    await harness.service.reassignTask(
      tasks.find((task) => task.title === 'build')!.id,
      agentIds['Dev']
    )

    await harness.service.start(orchestrationId)
    const designTask = (await harness.service.listTasks(orchestrationId)).find(
      (task) => task.title === 'design'
    )!
    const architectAgent = await harness.service.getAgent(agentIds['Architect'])

    // The architect's run produced a file artifact for the design task.
    harness.host.seedTaskArtifacts(designTask.id, [
      makeArtifact('design-doc', {
        producedByAgentId: agentIds['Architect'],
        producedByTaskId: designTask.id,
        runId: harness.host.prompts[0].runId,
        sessionId: architectAgent?.sessionId ?? 'sess-1'
      })
    ])
    harness.host.settleRun(harness.host.prompts[0].sessionId, harness.host.prompts[0].runId, {
      result: 'Design written'
    })

    await vi.waitFor(async () => {
      expect(harness.host.prompts).toHaveLength(2)
    }, 5000)
    expect(harness.host.prompts[1].message).toContain('design-doc.ts')

    const handoffs = await vi.waitFor(async () => {
      const list = await harness.service.listHandoffs(orchestrationId)
      expect(list).toHaveLength(1)
      return list
    }, 5000)
    expect(handoffs[0].fromAgentId).toBe(agentIds['Architect'])
    expect(handoffs[0].toAgentId).toBe(agentIds['Dev'])
    expect(handoffs[0].artifactIds).toEqual(['design-doc'])
  })

  it('routes the review gate through a reviewer agent and honors the verdict', async () => {
    const harness = createHarness()
    const { orchestrationId, agentIds } = await bootstrapOrchestration(harness, {
      agents: [
        { name: 'Dev', role: 'backend' },
        { name: 'Reviewer', role: 'reviewer', isReviewer: true }
      ],
      tasks: [{ key: 'work', assignedAgentId: null, reviewRequired: true }]
    })
    const tasks = await harness.service.listTasks(orchestrationId)
    await harness.service.reassignTask(tasks[0].id, agentIds['Dev'])

    await harness.service.start(orchestrationId)

    // Phase 1 — execute.
    expect(harness.host.prompts).toHaveLength(1)
    harness.host.settleRun(harness.host.prompts[0].sessionId, harness.host.prompts[0].runId, {
      result: 'Built the thing'
    })

    // Phase 2 — review dispatched to the reviewer agent.
    await vi.waitFor(async () => {
      expect(harness.host.prompts).toHaveLength(2)
    }, 5000)
    const reviewPrompt = harness.host.prompts[1]
    expect(reviewPrompt.message).toContain('[REVIEW: APPROVED]')
    let work = (await harness.service.listTasks(orchestrationId)).find(
      (task) => task.id === tasks[0].id
    )!
    expect(work.status).toBe('review')

    // Reviewer approves.
    harness.host.settleRun(reviewPrompt.sessionId, reviewPrompt.runId, {
      result: 'Nice work. [REVIEW: APPROVED]'
    })
    work = await vi.waitFor(async () => {
      const task = (await harness.service.listTasks(orchestrationId)).find(
        (item) => item.id === tasks[0].id
      )!
      expect(task.status).toBe('completed')
      return task
    }, 5000)
    expect(work.reviewVerdict).toBe('approved')

    await vi.waitFor(async () => {
      const finalState = await harness.service.getOrchestration(orchestrationId)
      expect(finalState?.status).toBe('completed')
    }, 5000)
    const evaluation = await harness.store.getEvaluation(orchestrationId)
    expect(evaluation?.status).toBe('passed')
  })

  it('fails a task whose reviewer rejects the work, with feedback on retry', async () => {
    const harness = createHarness()
    const { orchestrationId, agentIds } = await bootstrapOrchestration(harness, {
      agents: [
        { name: 'Dev', role: 'backend' },
        { name: 'Reviewer', role: 'reviewer', isReviewer: true }
      ],
      tasks: [{ key: 'work', assignedAgentId: null, reviewRequired: true }]
    })
    const tasks = await harness.service.listTasks(orchestrationId)
    await harness.service.reassignTask(tasks[0].id, agentIds['Dev'])
    await harness.service.start(orchestrationId)

    harness.host.settleRun(harness.host.prompts[0].sessionId, harness.host.prompts[0].runId, {
      result: 'Built the thing'
    })
    await vi.waitFor(async () => {
      expect(harness.host.prompts).toHaveLength(2)
    }, 5000)
    harness.host.settleRun(harness.host.prompts[1].sessionId, harness.host.prompts[1].runId, {
      result: 'Fails spec. [REVIEW: REJECTED]\nRewrite it.'
    })
    const failed = await vi.waitFor(async () => {
      const task = (await harness.service.listTasks(orchestrationId))[0]
      expect(task.status).toBe('failed')
      return task
    }, 5000)
    expect(failed.reviewVerdict).toBe('rejected')
    expect(failed.reviewSummary).toContain('Rewrite it.')

    // Retrying surfaces the reviewer feedback to the executor agent.
    await harness.service.retryTask({ taskId: failed.id })
    await vi.waitFor(async () => {
      expect(harness.host.prompts).toHaveLength(3)
    }, 5000)
    expect(harness.host.prompts[2].message).toContain('rejected by the reviewer')
    expect(harness.host.prompts[2].message).toContain('Rewrite it.')
  })
})

describe('OrchestratorService failure handling', () => {
  it('fails the task when the run fails or its evaluation fails', async () => {
    const harness = createHarness()
    const { orchestrationId, agentIds } = await bootstrapOrchestration(harness, {
      agents: [{ name: 'Dev', role: 'backend' }],
      tasks: [{ key: 'work', assignedAgentId: null }]
    })
    const tasks = await harness.service.listTasks(orchestrationId)
    await harness.service.reassignTask(tasks[0].id, agentIds['Dev'])
    await harness.service.start(orchestrationId)

    harness.host.settleRun(harness.host.prompts[0].sessionId, harness.host.prompts[0].runId, {
      status: 'failed',
      error: 'tests exploded'
    })
    let work = await vi.waitFor(async () => {
      const task = (await harness.service.listTasks(orchestrationId))[0]
      expect(task.status).toBe('failed')
      return task
    }, 5000)
    expect(work.error).toContain('tests exploded')

    // Retry — a new dispatch annotated as a retry of the previous run.
    await harness.service.retryTask({ taskId: work.id })
    await vi.waitFor(async () => {
      expect(harness.host.prompts).toHaveLength(2)
    }, 5000)
    const retryAnnotations = harness.host.annotations.filter(
      (item) => item.sessionId === harness.host.prompts[1].sessionId
    )
    expect(
      retryAnnotations.some((item) => item.annotation.relation === 'retry')
    ).toBe(true)
    expect(
      retryAnnotations.some(
        (item) => item.annotation.forkedFromRunId === harness.host.prompts[0].runId
      )
    ).toBe(true)
    work = (await harness.service.listTasks(orchestrationId))[0]
    expect(work.status).toBe('running')
    expect(work.retryCount).toBe(1)
  })

  it('marks running tasks cancelled when the orchestration is aborted', async () => {
    const harness = createHarness()
    const { orchestrationId, agentIds } = await bootstrapOrchestration(harness, {
      agents: [{ name: 'Dev', role: 'backend' }],
      tasks: [{ key: 'work', assignedAgentId: null }]
    })
    const tasks = await harness.service.listTasks(orchestrationId)
    await harness.service.reassignTask(tasks[0].id, agentIds['Dev'])
    await harness.service.start(orchestrationId)

    await harness.service.abort(orchestrationId)
    const _work = await vi.waitFor(async () => {
      const task = (await harness.service.listTasks(orchestrationId))[0]
      expect(task.status).toBe('cancelled')
      return task
    }, 5000)
    const orchestration = await harness.service.getOrchestration(orchestrationId)
    expect(orchestration?.status).toBe('aborted')
  })

  it('pauses with a reason instead of dispatching when the orchestration budget is exhausted', async () => {
    const harness = createHarness()
    const { orchestrationId, agentIds } = await bootstrapOrchestration(harness, {
      agents: [{ name: 'Dev', role: 'backend' }],
      tasks: [
        { key: 'one', assignedAgentId: null },
        { key: 'two', assignedAgentId: null }
      ],
      orchestration: { budget: { maxTokens: 150, maxCost: null } }
    })
    const tasks = await harness.service.listTasks(orchestrationId)
    await harness.service.reassignTask(tasks[0].id, agentIds['Dev'])
    await harness.service.reassignTask(tasks[1].id, agentIds['Dev'])
    await harness.service.start(orchestrationId)

    // Fake runs each use 200 tokens; the cap is 300.
    harness.host.settleRun(harness.host.prompts[0].sessionId, harness.host.prompts[0].runId, {
      result: 'done'
    })
    // Budget pause happens in reconcile after settle.
    await vi.waitFor(async () => {
      const orchestration = await harness.service.getOrchestration(orchestrationId)
      expect(orchestration?.status).toBe('paused')
    }, 5000)
    const orchestration = await harness.service.getOrchestration(orchestrationId)
    expect(orchestration?.pausedReason).toMatch(/budget/i)
    // No further dispatch happened.
    expect(harness.host.prompts).toHaveLength(1)
  })

  it('blocks agents whose individual budget is exhausted and unblocks on raise', async () => {
    const harness = createHarness()
    const { orchestrationId, agentIds } = await bootstrapOrchestration(harness, {
      agents: [{ name: 'Dev', role: 'backend', budget: { maxTokens: 100, maxCost: null } }],
      tasks: [
        { key: 'one', assignedAgentId: null },
        { key: 'two', assignedAgentId: null }
      ]
    })
    const tasks = await harness.service.listTasks(orchestrationId)
    await harness.service.reassignTask(tasks[0].id, agentIds['Dev'])
    await harness.service.reassignTask(tasks[1].id, agentIds['Dev'])
    await harness.service.start(orchestrationId)

    // The first task runs — each fake run spends 200 tokens.
    expect(harness.host.prompts).toHaveLength(1)
    harness.host.settleRun(harness.host.prompts[0].sessionId, harness.host.prompts[0].runId, {
      result: 'done'
    })
    // The agent's 100-token budget is now exhausted: the second task must not
    // dispatch and the agent flips to blocked.
    await vi.waitFor(async () => {
      const agent = await harness.service.getAgent(agentIds['Dev'])
      expect(agent?.status).toBe('blocked')
    }, 5000)
    expect(harness.host.prompts).toHaveLength(1)
    const blocked = (await harness.service.listTasks(orchestrationId)).find(
      (task) => task.title === 'two'
    )!
    expect(blocked.status).not.toBe('running')

    // Raising the budget unblocks the agent and lets the task dispatch.
    await harness.service.updateAgent(agentIds['Dev'], {
      budget: { maxTokens: null, maxCost: null }
    })
    const agent = await harness.service.getAgent(agentIds['Dev'])
    expect(agent?.status).not.toBe('blocked')
    await vi.waitFor(async () => {
      expect(harness.host.prompts).toHaveLength(2)
    }, 5000)
    expect(harness.host.prompts[1].message).toContain('two')
  })

  it('recovers interrupted orchestrations after a restart', async () => {
    const harness = createHarness()
    const { orchestrationId, agentIds } = await bootstrapOrchestration(harness, {
      agents: [{ name: 'Dev', role: 'backend' }],
      tasks: [{ key: 'work', assignedAgentId: null }]
    })
    const tasks = await harness.service.listTasks(orchestrationId)
    await harness.service.reassignTask(tasks[0].id, agentIds['Dev'])
    await harness.service.start(orchestrationId)
    expect(harness.host.prompts).toHaveLength(1)

    // Simulate restart: fresh service over the same persisted store.
    harness.service.detach()
    const second = new OrchestratorService(harness.store, harness.host)
    second.attach()
    const recovered = await second.recoverAll()
    expect(recovered).toBe(1)

    const orchestration = await second.getOrchestration(orchestrationId)
    expect(orchestration?.status).toBe('paused')
    expect(orchestration?.pausedReason).toMatch(/restart/i)
    const work = (await second.listTasks(orchestrationId))[0]
    expect(work.status).toBe('pending')

    // Resume → dispatches again.
    await second.resume(orchestrationId)
    await vi.waitFor(async () => {
      expect(harness.host.prompts).toHaveLength(2)
    }, 5000)
  })
})
