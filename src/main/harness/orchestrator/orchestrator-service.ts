/**
 * Harness Orchestrator.
 *
 * Multi-agent orchestration over the existing Harness Control Plane: tasks
 * with dependencies, concrete agents, real Pi sessions, artifact handoffs,
 * review gates, budgets and restart recovery. Every agent executes through
 * Pi — the orchestrator schedules and observes, it never fabricates
 * execution state.
 *
 * Design invariants:
 * - Task → Agent → Run → Trace → Artifact → Evaluation → Dependency → Next.
 * - Statuses are derived from real runtime events, never hand-set by the UI.
 * - Single-agent usage stays first-class; orchestration is a layer, not a
 *   replacement.
 */

import type {
  AgentHandoff,
  AgentTemplate,
  HarnessAgent,
  HarnessAgentCostShare,
  HarnessArtifact,
  HarnessEvent,
  HarnessEventEnvelope,
  HarnessEvaluationCheck,
  HarnessOrchestrationEvaluation,
  HarnessOrchestrationRun,
  HarnessOrchestrationSnapshot,
  HarnessOrchestrationStrategy,
  HarnessRun,
  HarnessTask,
  HarnessTaskPriority,
  HarnessTeam
} from '@shared/types/harness'
import type { StartAgentSessionInput } from '@shared/types/workspace'
import { HarnessError } from '../harness-error'
import { detectCycles } from './dependency-resolver'
import {
  OrchestrationStore,
  newOrchestrationId,
  newTaskId
} from './orchestration-store'
import { AgentManager, type AgentDefinition } from './agent-manager'
import { TeamService } from './team-service'
import { HandoffService } from './handoff-service'
import { ConflictService } from './conflict-service'
import { TaskScheduler, type DispatchCandidate, type SchedulingSnapshot } from './task-scheduler'
import { TaskContextBuilder, parseReviewVerdict } from './task-context-builder'
import type { RunRelationAnnotation } from '../runs/run-registry'

const STUCK_THRESHOLD_MS = 10 * 60 * 1000
const DEFAULT_MAX_CONCURRENT = 3

/** Everything the orchestrator needs from the runtime, injectable for tests. */
export interface OrchestratorHost {
  startSession(input: StartAgentSessionInput): Promise<{ sessionId: string; cwd: string }>
  prompt(sessionId: string, message: string): Promise<unknown>
  abortSession(sessionId: string): Promise<void>
  annotateNextRun(sessionId: string, annotation: RunRelationAnnotation): void
  setSessionName(sessionId: string, name: string): Promise<void>
  emitOrchestrationEvent(orchestrationId: string, event: HarnessEvent): void
  getOrchestrationTimeline(orchestrationId: string): HarnessEvent[]
  subscribe(listener: (payload: HarnessEventEnvelope) => void): () => void
  getRunById(runId: string): Promise<HarnessRun | null>
  listRunsByOrchestration(orchestrationId: string): Promise<HarnessRun[]>
  getArtifact(artifactId: string): Promise<HarnessArtifact | null>
  artifactsForTask(taskId: string): Promise<HarnessArtifact[]>
  artifactsForAgent(agentId: string): Promise<HarnessArtifact[]>
  markArtifactsConsumed(
    artifactIds: string[],
    agentId: string,
    taskId: string | null
  ): Promise<void>
  bindAgentSession(sessionId: string, cwd: string): Promise<void>
  createWorktree(cwd: string, branch: string): Promise<{ path: string; branch: string }>
}

export interface CreateOrchestrationInput {
  name?: string | null
  cwd: string
  strategy?: HarnessOrchestrationStrategy
  teamId?: string | null
  templateIds?: string[]
  maxConcurrentAgents?: number
  maxConcurrentRuns?: number
  budget?: { maxCost?: number | null; maxTokens?: number | null }
}

export interface CreateTaskInput {
  orchestrationId: string
  title: string
  description?: string | null
  priority?: HarnessTaskPriority
  assignedAgentId?: string | null
  parentTaskId?: string | null
  dependencies?: string[]
  inputArtifactIds?: string[]
  reviewRequired?: boolean
}

export interface UpdateTaskInput {
  title?: string
  description?: string | null
  priority?: HarnessTaskPriority
  assignedAgentId?: string | null
  parentTaskId?: string | null
  dependencies?: string[]
  inputArtifactIds?: string[]
  reviewRequired?: boolean
}

export interface UpdateAgentInput {
  name?: string
  description?: string | null
  provider?: string | null
  modelId?: string | null
  thinkingLevel?: string | null
  toolNames?: string[] | null
  budget?: { maxCost: number | null; maxTokens: number | null }
}

export interface RetryTaskInput {
  taskId: string
  /** Reassign to another agent before retrying. */
  agentId?: string | null
}

interface PendingDispatch {
  orchestrationId: string
  sessionId: string
  taskId: string
  agentId: string
  phase: 'execute' | 'review'
  runId: string | null
  startedAt: number
  lastEventAt: number
  notifiedStuck: boolean
}

const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled'])

export class OrchestratorService {
  readonly store: OrchestrationStore
  readonly teams: TeamService
  readonly agents: AgentManager
  readonly handoffs: HandoffService
  private readonly scheduler = new TaskScheduler()
  private readonly contextBuilder = new TaskContextBuilder()
  private readonly conflictService = new ConflictService()

  /** sessionId → the dispatch currently driving that session. */
  private readonly sessionDispatches = new Map<string, PendingDispatch>()
  /** runId → dispatch, bound when run.started arrives. */
  private readonly runDispatches = new Map<string, PendingDispatch>()
  /** Latest evaluation status per run (before run.completed arrives). */
  private readonly evaluationByRun = new Map<string, 'passed' | 'warning' | 'failed'>()
  /** Retry relation metadata for the next dispatch of a task. */
  private readonly retryAnnotations = new Map<
    string,
    { forkedFromRunId: string | null }
  >()
  /** policy.denied events counted per orchestration (in-memory; see note in buildFinalEvaluation). */
  private readonly policyViolations = new Map<string, number>()
  private unsubscribe: (() => void) | null = null
  private stuckTimer: ReturnType<typeof setInterval> | null = null

  constructor(store: OrchestrationStore, private readonly host: OrchestratorHost) {
    this.store = store
    this.teams = new TeamService(store)
    this.agents = new AgentManager(store, {
      bindSession: (sessionId, cwd) => this.host.bindAgentSession(sessionId, cwd),
      createWorktree: (cwd, branch) => this.host.createWorktree(cwd, branch),
      emitAgentEvent: (agent, event, extra) => this.emitAgentEvent(agent, event, extra)
    })
    this.handoffs = new HandoffService(store, {
      markConsumed: (artifactIds, agentId, taskId) =>
        this.host.markArtifactsConsumed(artifactIds, agentId, taskId),
      emit: (orchestrationId, event) => this.emit(orchestrationId ?? '', event)
    })
  }

  /** Wire the unified event stream (call once at app start). */
  attach(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.host.subscribe((payload) => this.handleEvent(payload))
    this.stuckTimer = setInterval(() => this.checkStuck(), 30_000)
  }

  detach(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.stuckTimer) clearInterval(this.stuckTimer)
    this.stuckTimer = null
  }

  // ------------------------------------------------------ orchestration CRUD

  async listOrchestrations(): Promise<HarnessOrchestrationRun[]> {
    return this.store.listOrchestrations()
  }

  async getOrchestration(id: string): Promise<HarnessOrchestrationRun | null> {
    return this.store.getOrchestration(id)
  }

  async createOrchestration(
    input: CreateOrchestrationInput
  ): Promise<HarnessOrchestrationRun> {
    if (!input.cwd?.trim()) {
      throw new HarnessError('INVALID_STATE', 'A project directory is required.')
    }
    const now = Date.now()
    const orchestration: HarnessOrchestrationRun = {
      id: newOrchestrationId(),
      name: input.name?.trim() || null,
      status: 'pending',
      strategy: input.strategy ?? 'dependency',
      cwd: input.cwd,
      taskIds: [],
      agentIds: [],
      maxConcurrentAgents: clampConcurrency(input.maxConcurrentAgents),
      maxConcurrentRuns: clampConcurrency(input.maxConcurrentRuns),
      budget: {
        maxCost: input.budget?.maxCost ?? null,
        maxTokens: input.budget?.maxTokens ?? null
      },
      startedAt: null,
      finishedAt: null,
      totalTokens: 0,
      estimatedCost: null,
      successCount: 0,
      failureCount: 0,
      pausedReason: null,
      createdAt: now,
      updatedAt: now
    }
    await this.store.saveOrchestration(orchestration)

    if (input.teamId) {
      const team = await this.store.getTeam(input.teamId)
      if (!team) {
        throw new HarnessError('TEAM_NOT_FOUND', `Team not found: ${input.teamId}`)
      }
      for (const templateId of team.agentTemplateIds) {
        const template = await this.store.getTemplate(templateId)
        if (template) await this.agents.fromTemplate(orchestration, template)
      }
    }
    for (const templateId of input.templateIds ?? []) {
      const template = await this.store.getTemplate(templateId)
      if (!template) {
        throw new HarnessError('TEMPLATE_NOT_FOUND', `Template not found: ${templateId}`)
      }
      await this.agents.fromTemplate(orchestration, template)
    }
    return orchestration
  }

  async deleteOrchestration(id: string): Promise<void> {
    const orchestration = await this.requireOrchestration(id)
    for (const dispatch of this.activeDispatches(id)) {
      this.clearDispatch(dispatch)
    }
    await this.store.deleteOrchestration(id)
    this.policyViolations.delete(id)
  }

  // ------------------------------------------------------------- agents CRUD

  async listAgents(orchestrationId?: string): Promise<HarnessAgent[]> {
    return this.store.listAgents(orchestrationId)
  }

  async getAgent(agentId: string): Promise<HarnessAgent | null> {
    return this.store.getAgent(agentId)
  }

  async addAgent(
    orcheststrationId: string,
    definition: AgentDefinition,
    templateId?: string | null
  ): Promise<HarnessAgent> {
    const orchestration = await this.requireOrchestration(orcheststrationId)
    if (templateId) {
      const template = await this.requireTemplate(templateId)
      return this.agents.fromTemplate(orchestration, template)
    }
    return this.agents.instantiate(orchestration, definition)
  }

  async updateAgent(agentId: string, patch: UpdateAgentInput): Promise<HarnessAgent> {
    const agent = await this.requireAgent(agentId)
    if (
      (patch.provider !== undefined && patch.provider !== agent.provider) ||
      (patch.modelId !== undefined && patch.modelId !== agent.modelId)
    ) {
      if (agent.status === 'running') {
        throw new HarnessError(
          'AGENT_RUNNING',
          'Cannot change the model of an agent while it is running.'
        )
      }
    }
    const next = await this.agents.update(agentId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.modelId !== undefined ? { modelId: patch.modelId } : {}),
      ...(patch.thinkingLevel !== undefined ? { thinkingLevel: patch.thinkingLevel } : {}),
      ...(patch.toolNames !== undefined ? { toolNames: patch.toolNames } : {}),
      ...(patch.budget !== undefined ? { budget: patch.budget } : {})
    })
    // Raising a budget can unblock a budget-blocked agent.
    if (
      agent.status === 'blocked' &&
      patch.budget &&
      (patch.budget.maxCost === null || patch.budget.maxCost > 0) &&
      (patch.budget.maxTokens === null || patch.budget.maxTokens > 0)
    ) {
      const usage = await this.agentUsage(agentId, agent.orchestrationId)
      const costOk =
        patch.budget.maxCost === null ||
        (usage.estimatedCost ?? 0) < patch.budget.maxCost
      const tokenOk =
        patch.budget.maxTokens === null || usage.totalTokens < patch.budget.maxTokens
      if (costOk && tokenOk) {
        return this.agents.update(agentId, { status: 'idle' })
      }
    }
    return next
  }

  async deleteAgent(agentId: string): Promise<void> {
    const agent = await this.requireAgent(agentId)
    if (agent.status === 'running' || agent.status === 'queued') {
      throw new HarnessError(
        'AGENT_RUNNING',
        'Cannot delete an agent that is running a task.'
      )
    }
    await this.store.deleteAgent(agentId)
    this.emit(agent.orchestrationId ?? '', {
      type: 'agent.deleted',
      timestamp: Date.now(),
      agentId,
      name: agent.name
    })
  }

  // -------------------------------------------------------------- teams CRUD

  async listTemplates(): Promise<AgentTemplate[]> {
    return this.teams.listTemplates()
  }

  async listTeams(): Promise<HarnessTeam[]> {
    return this.teams.listTeams()
  }

  async ensureBuiltinPresets(): Promise<void> {
    await this.teams.ensureBuiltinPresets()
  }

  async createTemplate(input: {
    name: string
    role: string
    description?: string | null
    systemPrompt?: string | null
    provider?: string | null
    modelId?: string | null
    thinkingLevel?: string | null
    toolNames?: string[] | null
    skillIds?: string[]
    workspaceMode?: AgentTemplate['workspaceMode']
    isReviewer?: boolean
  }): Promise<AgentTemplate> {
    return this.teams.createTemplate(input)
  }

  async updateTemplate(
    id: string,
    input: Parameters<TeamService['updateTemplate']>[1]
  ): Promise<AgentTemplate> {
    return this.teams.updateTemplate(id, input)
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.teams.deleteTemplate(id)
  }

  async createTeam(input: {
    name: string
    description?: string | null
    agentTemplateIds: string[]
  }): Promise<HarnessTeam> {
    return this.teams.createTeam(input)
  }

  async updateTeam(
    id: string,
    input: Parameters<TeamService['updateTeam']>[1]
  ): Promise<HarnessTeam> {
    return this.teams.updateTeam(id, input)
  }

  async deleteTeam(id: string): Promise<void> {
    await this.teams.deleteTeam(id)
  }

  // --------------------------------------------------- orchestration control

  async start(orchestrationId: string): Promise<HarnessOrchestrationRun> {
    const orchestration = await this.requireOrchestration(orchestrationId)
    if (orchestration.status === 'running') return orchestration
    if (orchestration.status !== 'pending' && orchestration.status !== 'paused') {
      throw new HarnessError(
        'ORCHESTRATION_NOT_RUNNING',
        `Cannot start an orchestration in status "${orchestration.status}".`
      )
    }
    const tasks = await this.store.listTasks(orchestrationId)
    const cycles = detectCycles(tasks)
    if (cycles.length) {
      throw new HarnessError(
        'DEPENDENCY_CYCLE',
        `Dependency cycle detected: ${cycles.map((cycle) => cycle.join(' → ')).join('; ')}. Fix the task graph before starting.`
      )
    }
    const next: HarnessOrchestrationRun = {
      ...orchestration,
      status: 'running',
      pausedReason: null,
      startedAt: orchestration.startedAt ?? Date.now(),
      updatedAt: Date.now()
    }
    await this.store.saveOrchestration(next)
    this.emit(orchestrationId, {
      type: 'orchestration.started',
      timestamp: Date.now(),
      orchestrationId
    })
    await this.reconcile(orchestrationId)
    return next
  }

  async pause(orchestrationId: string, reason?: string): Promise<HarnessOrchestrationRun> {
    const orchestration = await this.requireOrchestration(orchestrationId)
    if (orchestration.status !== 'running') return orchestration
    const paused: HarnessOrchestrationRun = {
      ...orchestration,
      status: 'paused',
      pausedReason: reason ?? 'paused by user',
      updatedAt: Date.now()
    }
    await this.store.saveOrchestration(paused)
    this.emit(orchestrationId, {
      type: 'orchestration.paused',
      timestamp: Date.now(),
      orchestrationId,
      ...(reason ? { reason } : {})
    })
    return paused
  }

  async resume(orchestrationId: string): Promise<HarnessOrchestrationRun> {
    const orchestration = await this.requireOrchestration(orchestrationId)
    if (orchestration.status !== 'paused') return orchestration
    return this.start(orchestrationId)
  }

  /**
   * Abort: no new dispatches, in-flight runs are aborted through the real
   * runtime; their settle events mark the tasks cancelled (not failed).
   */
  async abort(orchestrationId: string): Promise<HarnessOrchestrationRun> {
    const orchestration = await this.requireOrchestration(orchestrationId)
    if (
      orchestration.status === 'completed' ||
      orchestration.status === 'failed' ||
      orchestration.status === 'aborted'
    ) {
      return orchestration
    }
    const next: HarnessOrchestrationRun = {
      ...orchestration,
      status: 'aborted',
      finishedAt: Date.now(),
      pausedReason: null,
      updatedAt: Date.now()
    }
    await this.store.saveOrchestration(next)
    for (const dispatch of this.activeDispatches(orchestrationId)) {
      try {
        await this.host.abortSession(dispatch.sessionId)
      } catch {
        // The session may already be gone; settle events handle the rest.
      }
    }
    // Tasks stuck in non-terminal runtime states are cancelled now; in-flight
    // runs settle through events and mark their tasks cancelled as well.
    const tasks = await this.store.listTasks(orchestrationId)
    for (const task of tasks) {
      if (!TERMINAL_TASK_STATUSES.has(task.status) && task.status !== 'running') {
        await this.store.saveTask({
          ...task,
          status: 'cancelled',
          finishedAt: Date.now()
        })
        this.emit(orchestrationId, {
          type: 'task.cancelled',
          timestamp: Date.now(),
          taskId: task.id
        })
      }
    }
    this.emit(orchestrationId, {
      type: 'orchestration.aborted',
      timestamp: Date.now(),
      orchestrationId
    })
    return next
  }

  /**
   * Restart recovery: dispatch state lives in memory and dies with the app.
   * Tasks that were mid-flight become pending again (their runs keep their
   * real history); the orchestration pauses so the user decides to resume.
   */
  async recoverAll(): Promise<number> {
    const orchestrations = await this.store.listOrchestrations()
    let recovered = 0
    for (const orchestration of orchestrations) {
      if (orchestration.status === 'running' || orchestration.status === 'paused') {
        await this.recoverOrchestration(orchestration.id)
        recovered += 1
      }
    }
    return recovered
  }

  async recoverOrchestration(orchestrationId: string): Promise<HarnessOrchestrationRun> {
    const orchestration = await this.requireOrchestration(orchestrationId)
    const tasks = await this.store.listTasks(orchestrationId)
    for (const task of tasks) {
      if (
        task.status === 'running' ||
        task.status === 'verifying' ||
        task.status === 'review'
      ) {
        await this.store.saveTask({
          ...task,
          status: 'pending',
          error: 'Interrupted by app restart'
        })
      }
    }
    const agents = await this.store.listAgents(orchestrationId)
    for (const agent of agents) {
      if (['queued', 'running', 'waiting', 'verifying'].includes(agent.status)) {
        await this.store.saveAgent({
          ...agent,
          status: 'idle',
          currentTaskId: null,
          currentRunId: null,
          updatedAt: Date.now()
        })
      }
    }
    const wasRunning = orchestration.status === 'running'
    const next: HarnessOrchestrationRun = {
      ...orchestration,
      status: 'paused',
      pausedReason: 'Interrupted by app restart',
      updatedAt: Date.now()
    }
    await this.store.saveOrchestration(next)
    if (wasRunning) {
      this.emit(orchestrationId, {
        type: 'orchestration.paused',
        timestamp: Date.now(),
        orchestrationId,
        reason: 'Interrupted by app restart'
      })
    }
    return next
  }

  // -------------------------------------------------------------- tasks CRUD

  async listTasks(orchestrationId?: string): Promise<HarnessTask[]> {
    return this.store.listTasks(orchestrationId)
  }

  async getTask(taskId: string): Promise<HarnessTask | null> {
    return this.store.getTask(taskId)
  }

  async createTask(input: CreateTaskInput): Promise<HarnessTask> {
    const orchestration = await this.requireOrchestration(input.orchestrationId)
    if (!input.title?.trim()) {
      throw new HarnessError('INVALID_STATE', 'A task title is required.')
    }
    if (orchestration.status === 'aborted' || orchestration.status === 'completed') {
      throw new HarnessError(
        'ORCHESTRATION_NOT_RUNNING',
        `Cannot add tasks to an orchestration in status "${orchestration.status}".`
      )
    }
    await this.validateTaskGraph(
      input.orchestrationId,
      input.dependencies ?? [],
      input.parentTaskId ?? null
    )
    if (input.assignedAgentId) {
      await this.requireAgent(input.assignedAgentId)
    }
    const now = Date.now()
    const task: HarnessTask = {
      id: newTaskId(),
      orchestrationId: input.orchestrationId,
      projectId: null,
      title: input.title.trim(),
      description: input.description ?? null,
      status: 'pending',
      priority: input.priority ?? 'normal',
      assignedAgentId: input.assignedAgentId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      dependencies: [...(input.dependencies ?? [])],
      inputArtifactIds: [...(input.inputArtifactIds ?? [])],
      runIds: [],
      artifactIds: [],
      lastRunId: null,
      retryCount: 0,
      reviewRequired: input.reviewRequired ?? false,
      reviewAgentId: null,
      reviewVerdict: null,
      reviewSummary: null,
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null
    }
    await this.store.saveTask(task)
    await this.addTaskToOrchestration(orchestration, task.id)
    this.emit(input.orchestrationId, {
      type: 'task.created',
      timestamp: Date.now(),
      taskId: task.id,
      title: task.title
    })
    if (orchestration.status === 'running' || orchestration.status === 'paused') {
      await this.reconcile(input.orchestrationId)
    }
    return task
  }

  async updateTask(taskId: string, patch: UpdateTaskInput): Promise<HarnessTask> {
    const task = await this.requireTask(taskId)
    if (task.status === 'running' || task.status === 'verifying') {
      throw new HarnessError(
        'ORCHESTRATION_BUSY',
        'Cannot edit a task while it is running.'
      )
    }
    if (patch.dependencies) {
      await this.validateTaskGraph(task.orchestrationId ?? '', patch.dependencies, patch.parentTaskId ?? task.parentTaskId, taskId)
    }
    if (patch.assignedAgentId) {
      await this.requireAgent(patch.assignedAgentId)
    }
    const next: HarnessTask = {
      ...task,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.assignedAgentId !== undefined ? { assignedAgentId: patch.assignedAgentId } : {}),
      ...(patch.parentTaskId !== undefined ? { parentTaskId: patch.parentTaskId } : {}),
      ...(patch.dependencies !== undefined ? { dependencies: [...patch.dependencies] } : {}),
      ...(patch.inputArtifactIds !== undefined
        ? { inputArtifactIds: [...patch.inputArtifactIds] }
        : {}),
      ...(patch.reviewRequired !== undefined ? { reviewRequired: patch.reviewRequired } : {})
    }
    await this.store.saveTask(next)
    if (task.orchestrationId && task.status !== 'pending') {
      await this.reconcile(task.orchestrationId)
    }
    return next
  }

  async deleteTask(taskId: string): Promise<void> {
    const task = await this.requireTask(taskId)
    if (task.status === 'running' || task.status === 'verifying') {
      throw new HarnessError(
        'ORCHESTRATION_BUSY',
        'Cannot delete a task while it is running.'
      )
    }
    await this.store.deleteTask(taskId)
    if (task.orchestrationId) {
      const orchestration = await this.store.getOrchestration(task.orchestrationId)
      if (orchestration) {
        await this.store.saveOrchestration({
          ...orchestration,
          taskIds: orchestration.taskIds.filter((id) => id !== taskId),
          updatedAt: Date.now()
        })
      }
      if (orchestration?.status === 'running') {
        await this.reconcile(task.orchestrationId)
      }
    }
  }

  /**
   * Retry a task: a fresh run through the real runtime, related to the
   * original run (relation: retry) so the run tree keeps the full history.
   */
  async retryTask(input: RetryTaskInput): Promise<HarnessTask> {
    const task = await this.requireTask(input.taskId)
    const orchestration = await this.requireOrchestration(task.orchestrationId ?? '')
    if (orchestration.status !== 'running' && orchestration.status !== 'paused') {
      throw new HarnessError(
        'ORCHESTRATION_NOT_RUNNING',
        `Cannot retry a task while the orchestration is "${orchestration.status}".`
      )
    }
    const next: HarnessTask = {
      ...task,
      status: 'pending',
      retryCount: task.retryCount + 1,
      error: null,
      reviewVerdict: null,
      reviewSummary: null,
      finishedAt: null,
      ...(input.agentId ? { assignedAgentId: input.agentId } : {})
    }
    if (input.agentId) {
      await this.requireAgent(input.agentId)
    }
    await this.store.saveTask(next)
    this.retryAnnotations.set(task.id, { forkedFromRunId: task.lastRunId })
    this.emit(orchestration.id, {
      type: 'task.ready',
      timestamp: Date.now(),
      taskId: task.id
    })
    if (orchestration.status === 'running') {
      await this.reconcile(orchestration.id)
    }
    return next
  }

  /** Skip a task: cancelled, dependents see it as unmet unless their graph is edited. */
  async skipTask(taskId: string): Promise<HarnessTask> {
    const task = await this.requireTask(taskId)
    if (task.status === 'running' || task.status === 'verifying') {
      throw new HarnessError(
        'ORCHESTRATION_BUSY',
        'Cannot skip a task while it is running. Abort the orchestration or wait for it to settle.'
      )
    }
    const next: HarnessTask = {
      ...task,
      status: 'cancelled',
      finishedAt: Date.now(),
      error: null
    }
    await this.store.saveTask(next)
    this.emit(task.orchestrationId ?? '', {
      type: 'task.cancelled',
      timestamp: Date.now(),
      taskId: task.id
    })
    if (task.orchestrationId) {
      await this.reconcile(task.orchestrationId)
    }
    return next
  }

  /** Reassign a pending / blocked task to another agent. */
  async reassignTask(taskId: string, agentId: string): Promise<HarnessTask> {
    const task = await this.requireTask(taskId)
    if (task.status === 'running' || task.status === 'verifying' || task.status === 'review') {
      throw new HarnessError(
        'ORCHESTRATION_BUSY',
        'Cannot reassign a task that is currently executing or under review.'
      )
    }
    await this.requireAgent(agentId)
    const next: HarnessTask = { ...task, assignedAgentId: agentId }
    await this.store.saveTask(next)
    if (task.orchestrationId) {
      const orchestration = await this.store.getOrchestration(task.orchestrationId)
      if (orchestration?.status === 'running') {
        await this.reconcile(task.orchestrationId)
      }
    }
    return next
  }

  // ------------------------------------------------------- dispatch machinery

  private async dispatchCandidate(
    orchestration: HarnessOrchestrationRun,
    candidate: DispatchCandidate
  ): Promise<void> {
    const { task, agentId } = candidate
    const agent = await this.store.getAgent(agentId)
    if (!agent) return

    const usage = await this.agentUsage(agentId, orchestration.id)
    if (agent.status === 'blocked') return
    if (agent.budget.maxCost !== null && (usage.estimatedCost ?? 0) >= agent.budget.maxCost) {
      await this.agents.update(agentId, { status: 'blocked' })
      this.emit(orchestration.id, {
        type: 'agent.waiting',
        timestamp: Date.now(),
        agentId,
        taskId: task.id,
        reason: 'agent cost budget reached'
      })
      return
    }
    if (agent.budget.maxTokens !== null && usage.totalTokens >= agent.budget.maxTokens) {
      await this.agents.update(agentId, { status: 'blocked' })
      this.emit(orchestration.id, {
        type: 'agent.waiting',
        timestamp: Date.now(),
        agentId,
        taskId: task.id,
        reason: 'agent token budget reached'
      })
      return
    }

    try {
      await this.agents.prepareWorkspace(agentId)
    } catch (error) {
      await this.failTask(
        task,
        `Failed to prepare agent workspace: ${toMessage(error)}`
      )
      return
    }

    const fresh = await this.requireAgent(agentId)
    const cwd = fresh.worktreePath ?? fresh.cwd ?? orchestration.cwd
    let sessionId = fresh.sessionId
    try {
      if (!sessionId) {
        const started = await this.host.startSession({
          cwd: cwd ?? undefined,
          ...(fresh.provider ? { provider: fresh.provider } : {}),
          ...(fresh.modelId ? { modelId: fresh.modelId } : {}),
          ...(fresh.thinkingLevel ? { thinkingLevel: fresh.thinkingLevel } : {}),
          ...(fresh.toolNames ? { toolNames: fresh.toolNames } : {})
        })
        sessionId = started.sessionId
        await this.agents.bindSession(agentId, sessionId)
        await this.host
          .setSessionName(sessionId, `${fresh.name} (${fresh.role})`)
          .catch(() => undefined)
      }
    } catch (error) {
      await this.failTask(task, `Failed to start agent session: ${toMessage(error)}`)
      return
    }

    const context = await this.buildTaskContext(task, fresh)
    const dispatch: PendingDispatch = {
      orchestrationId: orchestration.id,
      sessionId,
      taskId: task.id,
      agentId,
      phase: 'execute',
      runId: null,
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      notifiedStuck: false
    }
    this.sessionDispatches.set(sessionId, dispatch)

    const retry = this.retryAnnotations.get(task.id)
    const annotation: RunRelationAnnotation = {
      agentId,
      taskId: task.id,
      orchestrationId: orchestration.id,
      ...(retry
        ? { relation: 'retry' as const, forkedFromRunId: retry.forkedFromRunId }
        : {})
    }
    this.host.annotateNextRun(sessionId, annotation)

    await this.store.saveTask({
      ...task,
      status: 'running',
      startedAt: task.startedAt ?? Date.now(),
      error: null
    })
    await this.agents.update(agentId, {
      status: 'running',
      currentTaskId: task.id,
      currentRunId: null
    })

    try {
      await this.host.prompt(sessionId, context.prompt)
    } catch (error) {
      this.clearDispatch(dispatch)
      await this.failTask(task, `Prompt failed: ${toMessage(error)}`)
      await this.agents.update(agentId, {
        status: 'failed',
        currentTaskId: null,
        currentRunId: null
      })
      await this.reconcile(orchestration.id)
      return
    }
    // run.started fires synchronously during prompt submission and binds
    // dispatch.runId + emits task.started / agent.started.

    for (const [producerAgentId, artifactIds] of context.handoffProducers) {
      await this.handoffs.record({
        orchestrationId: orchestration.id,
        fromAgentId: producerAgentId,
        toAgentId: agentId,
        taskId: task.id,
        artifactIds,
        summary: `Context for task "${task.title}"`
      })
    }
  }

  private async buildTaskContext(
    task: HarnessTask,
    agent: HarnessAgent
  ): Promise<{ prompt: string; handoffProducers: Map<string, string[]> }> {
    const orchestrationId = task.orchestrationId
    const allTasks = orchestrationId ? await this.store.listTasks(orchestrationId) : []
    const dependencyTasks = allTasks.filter((item) => task.dependencies.includes(item.id))
    const runs = orchestrationId
      ? await this.host.listRunsByOrchestration(orchestrationId)
      : []
    const dependencyRuns = runs.filter((run) =>
      task.dependencies.includes(run.taskId ?? '')
    )

    const artifacts: HarnessArtifact[] = []
    for (const artifactId of task.inputArtifactIds) {
      const artifact = await this.host.getArtifact(artifactId)
      if (artifact) artifacts.push(artifact)
    }
    for (const dependency of dependencyTasks) {
      const produced = await this.host.artifactsForTask(dependency.id)
      for (const artifact of produced) {
        if (!artifacts.some((item) => item.id === artifact.id)) artifacts.push(artifact)
      }
    }

    const context = this.contextBuilder.build({
      task,
      agent,
      dependencyTasks,
      dependencyRuns,
      artifacts,
      reviewMode: false
    })
    const handoffProducers = new Map<string, string[]>()
    for (const artifact of artifacts) {
      if (!artifact.producedByAgentId) continue
      if (artifact.producedByAgentId === agent.id) continue
      if (!context.referencedArtifactIds.includes(artifact.id)) continue
      const list = handoffProducers.get(artifact.producedByAgentId) ?? []
      list.push(artifact.id)
      handoffProducers.set(artifact.producedByAgentId, list)
    }
    return { prompt: context.prompt, handoffProducers }
  }

  // --------------------------------------------------------- unified events

  private handleEvent({ sessionId, event }: HarnessEventEnvelope): void {
    const dispatch = this.sessionDispatches.get(sessionId)
    if (!dispatch) return
    dispatch.lastEventAt = Date.now()

    switch (event.type) {
      case 'run.started': {
        if (dispatch.runId) return
        dispatch.runId = event.runId
        this.runDispatches.set(event.runId, dispatch)
        void this.onRunStarted(dispatch, event.runId)
        break
      }
      case 'evaluation.started': {
        if (event.runId !== dispatch.runId) return
        void this.setTaskVerifying(dispatch)
        break
      }
      case 'evaluation.completed': {
        this.evaluationByRun.set(event.runId, event.status)
        break
      }
      case 'run.completed':
      case 'run.failed':
      case 'run.aborted': {
        if (event.runId !== dispatch.runId) return
        void this.settleDispatch(dispatch, event)
        break
      }
      case 'policy.denied': {
        this.policyViolations.set(
          dispatch.orchestrationId,
          (this.policyViolations.get(dispatch.orchestrationId) ?? 0) + 1
        )
        break
      }
      default:
        break
    }
  }

  private async onRunStarted(dispatch: PendingDispatch, runId: string): Promise<void> {
    const task = await this.store.getTask(dispatch.taskId)
    if (task && !task.runIds.includes(runId)) {
      await this.store.saveTask({
        ...task,
        runIds: [...task.runIds, runId],
        lastRunId: runId
      })
    }
    await this.agents.update(dispatch.agentId, {
      currentRunId: runId,
      status: 'running'
    })
    this.emit(dispatch.orchestrationId, {
      type: 'task.started',
      timestamp: Date.now(),
      taskId: dispatch.taskId,
      agentId: dispatch.agentId,
      runId
    })
    this.emit(dispatch.orchestrationId, {
      type: 'agent.started',
      timestamp: Date.now(),
      agentId: dispatch.agentId,
      taskId: dispatch.taskId,
      runId
    })
  }

  private async setTaskVerifying(dispatch: PendingDispatch): Promise<void> {
    if (dispatch.phase !== 'execute') return
    const task = await this.store.getTask(dispatch.taskId)
    if (!task || task.status !== 'running') return
    await this.store.saveTask({ ...task, status: 'verifying' })
    await this.agents.update(dispatch.agentId, { status: 'verifying' })
  }

  private async settleDispatch(
    dispatch: PendingDispatch,
    event: Extract<HarnessEvent, { type: 'run.completed' | 'run.failed' | 'run.aborted' }>
  ): Promise<void> {
    const run = await this.host.getRunById(event.runId)
    const task = await this.store.getTask(dispatch.taskId)
    this.clearDispatch(dispatch)
    if (!task) return

    if (dispatch.phase === 'review') {
      await this.handleReviewSettled(dispatch, task, event, run)
    } else {
      await this.handleExecuteSettled(dispatch, task, event, run)
    }
  }

  private async handleExecuteSettled(
    dispatch: PendingDispatch,
    task: HarnessTask,
    event: Extract<HarnessEvent, { type: 'run.completed' | 'run.failed' | 'run.aborted' }>,
    run: HarnessRun | null
  ): Promise<void> {
    const orchestration = await this.store.getOrchestration(dispatch.orchestrationId)
    if (!orchestration) return

    if (event.type !== 'run.completed') {
      const aborted = orchestration.status === 'aborted'
      const reason =
        event.type === 'run.aborted'
          ? 'Run aborted'
          : event.type === 'run.failed' && event.error
            ? event.error
            : (run?.error ?? 'Run failed')
      if (aborted) {
        await this.cancelTask(task)
      } else {
        await this.failTask(task, reason)
      }
      await this.agents.update(dispatch.agentId, {
        status: aborted ? 'aborted' : 'failed',
        currentTaskId: null,
        currentRunId: null
      })
      await this.reconcile(orchestration.id)
      return
    }

    const evaluation = this.evaluationByRun.get(event.runId)
    if (evaluation === 'failed') {
      await this.failTask(task, 'Run evaluation failed')
      await this.agents.update(dispatch.agentId, {
        status: 'failed',
        currentTaskId: null,
        currentRunId: null
      })
      await this.reconcile(orchestration.id)
      return
    }

    if (task.reviewRequired) {
      await this.startReviewGate(task, run)
      return
    }
    await this.completeTask(task, run)
  }

  private async startReviewGate(
    task: HarnessTask,
    run: HarnessRun | null
  ): Promise<void> {
    const orchestration = await this.store.getOrchestration(task.orchestrationId ?? '')
    if (!orchestration) {
      await this.completeTask(task, run)
      return
    }
    const agents = await this.store.listAgents(orchestration.id)
    const reviewer =
      (task.reviewAgentId ? agents.find((agent) => agent.id === task.reviewAgentId) : null) ??
      agents.find(
        (agent) =>
          agent.isReviewer &&
          agent.status === 'idle' &&
          agent.id !== task.assignedAgentId
      )
    await this.store.saveTask({
      ...task,
      status: 'review',
      reviewAgentId: task.reviewAgentId ?? reviewer?.id ?? null
    })
    if (task.assignedAgentId) {
      await this.agents.update(task.assignedAgentId, {
        status: 'waiting',
        currentTaskId: null,
        currentRunId: null
      })
      this.emit(orchestration.id, {
        type: 'agent.waiting',
        timestamp: Date.now(),
        agentId: task.assignedAgentId,
        taskId: task.id,
        reason: 'waiting for review'
      })
    }
    if (!reviewer) {
      this.emit(orchestration.id, {
        type: 'task.blocked',
        timestamp: Date.now(),
        taskId: task.id,
        reason: 'review required but no reviewer agent is available'
      })
      await this.reconcile(orchestration.id)
      return
    }
    await this.dispatchReview(task, reviewer, run)
  }

  private async dispatchReview(
    task: HarnessTask,
    reviewer: HarnessAgent,
    run: HarnessRun | null
  ): Promise<void> {
    const orchestration = await this.store.getOrchestration(task.orchestrationId ?? '')
    if (!orchestration) return
    try {
      await this.agents.prepareWorkspace(reviewer.id)
    } catch (error) {
      await this.failTask(task, `Failed to prepare reviewer workspace: ${toMessage(error)}`)
      return
    }
    const fresh = await this.requireAgent(reviewer.id)
    const cwd = fresh.worktreePath ?? fresh.cwd ?? orchestration.cwd
    let sessionId = fresh.sessionId
    try {
      if (!sessionId) {
        const started = await this.host.startSession({
          cwd: cwd ?? undefined,
          ...(fresh.provider ? { provider: fresh.provider } : {}),
          ...(fresh.modelId ? { modelId: fresh.modelId } : {}),
          ...(fresh.thinkingLevel ? { thinkingLevel: fresh.thinkingLevel } : {}),
          ...(fresh.toolNames ? { toolNames: fresh.toolNames } : {})
        })
        sessionId = started.sessionId
        await this.agents.bindSession(reviewer.id, sessionId)
        await this.host
          .setSessionName(sessionId, `${fresh.name} (${fresh.role})`)
          .catch(() => undefined)
      }
    } catch (error) {
      await this.failTask(task, `Failed to start reviewer session: ${toMessage(error)}`)
      return
    }

    const artifacts = await this.host.artifactsForTask(task.id)
    const taskRuns = (await this.host.listRunsByOrchestration(orchestration.id)).filter(
      (item) => item.taskId === task.id
    )
    const context = this.contextBuilder.buildReview({
      task,
      agent: fresh,
      artifacts,
      runs: run ? [run, ...taskRuns.filter((item) => item.id !== run.id)] : taskRuns
    })

    const dispatch: PendingDispatch = {
      orchestrationId: orchestration.id,
      sessionId,
      taskId: task.id,
      agentId: reviewer.id,
      phase: 'review',
      runId: null,
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      notifiedStuck: false
    }
    this.sessionDispatches.set(sessionId, dispatch)
    this.host.annotateNextRun(sessionId, {
      agentId: reviewer.id,
      taskId: task.id,
      orchestrationId: orchestration.id
    })
    await this.agents.update(reviewer.id, {
      status: 'running',
      currentTaskId: task.id,
      currentRunId: null
    })
    this.emit(orchestration.id, {
      type: 'review.started',
      timestamp: Date.now(),
      taskId: task.id,
      agentId: reviewer.id
    })
    try {
      await this.host.prompt(sessionId, context.prompt)
    } catch (error) {
      this.clearDispatch(dispatch)
      await this.agents.update(reviewer.id, {
        status: 'failed',
        currentTaskId: null,
        currentRunId: null
      })
      await this.store.saveTask({
        ...task,
        status: 'review',
        error: `Review dispatch failed: ${toMessage(error)}`
      })
      await this.reconcile(orchestration.id)
    }
  }

  private async handleReviewSettled(
    dispatch: PendingDispatch,
    task: HarnessTask,
    event: Extract<HarnessEvent, { type: 'run.completed' | 'run.failed' | 'run.aborted' }>,
    run: HarnessRun | null
  ): Promise<void> {
    await this.agents.update(dispatch.agentId, {
      status: 'idle',
      currentTaskId: null,
      currentRunId: null
    })
    if (event.type !== 'run.completed') {
      // The review itself failed; the task waits for a user decision.
      await this.store.saveTask({
        ...task,
        status: 'review',
        error: 'Review run failed — retry the task or reassign the reviewer.'
      })
      this.emit(dispatch.orchestrationId, {
        type: 'task.blocked',
        timestamp: Date.now(),
        taskId: task.id,
        reason: 'review run failed'
      })
      await this.reconcile(dispatch.orchestrationId)
      return
    }
    const verdict = run ? parseReviewVerdict(run.result) : null
    const approved = verdict?.verdict === 'approved'
    const next: HarnessTask = {
      ...task,
      reviewAgentId: dispatch.agentId,
      reviewVerdict: approved ? 'approved' : 'rejected',
      reviewSummary:
        verdict?.summary ?? 'The reviewer did not return an explicit verdict.'
    }
    this.emit(dispatch.orchestrationId, {
      type: approved ? 'review.approved' : 'review.rejected',
      timestamp: Date.now(),
      taskId: task.id,
      agentId: dispatch.agentId
    })
    if (approved) {
      await this.completeTask(next, run)
    } else {
      await this.failTask(
        next,
        `Rejected by reviewer: ${next.reviewSummary ?? 'no summary provided'}`
      )
    }
  }

  private async completeTask(
    task: HarnessTask,
    run: HarnessRun | null
  ): Promise<void> {
    const artifacts = await this.host.artifactsForTask(task.id)
    const next: HarnessTask = {
      ...task,
      status: 'completed',
      finishedAt: Date.now(),
      error: null,
      artifactIds: artifacts.map((artifact) => artifact.id),
      ...(run ? { lastRunId: run.id } : {})
    }
    await this.store.saveTask(next)
    const orchestrationId = task.orchestrationId ?? ''
    this.emit(orchestrationId, {
      type: 'task.completed',
      timestamp: Date.now(),
      taskId: task.id
    })
    if (task.assignedAgentId) {
      this.emit(orchestrationId, {
        type: 'agent.completed',
        timestamp: Date.now(),
        agentId: task.assignedAgentId,
        taskId: task.id,
        ...(run ? { runId: run.id } : {})
      })
      await this.agents.update(task.assignedAgentId, {
        status: 'idle',
        currentTaskId: null,
        currentRunId: null
      })
    }
    await this.reconcile(orchestrationId)
  }

  private async failTask(task: HarnessTask, error: string): Promise<void> {
    const next: HarnessTask = {
      ...task,
      status: 'failed',
      error,
      finishedAt: Date.now()
    }
    await this.store.saveTask(next)
    const orchestrationId = task.orchestrationId ?? ''
    this.emit(orchestrationId, {
      type: 'task.failed',
      timestamp: Date.now(),
      taskId: task.id,
      error
    })
    if (task.assignedAgentId) {
      this.emit(orchestrationId, {
        type: 'agent.failed',
        timestamp: Date.now(),
        agentId: task.assignedAgentId,
        taskId: task.id
      })
    }
  }

  private async cancelTask(task: HarnessTask): Promise<void> {
    const next: HarnessTask = {
      ...task,
      status: 'cancelled',
      finishedAt: Date.now(),
      error: null
    }
    await this.store.saveTask(next)
    this.emit(task.orchestrationId ?? '', {
      type: 'task.cancelled',
      timestamp: Date.now(),
      taskId: task.id
    })
    if (task.assignedAgentId) {
      await this.agents.update(task.assignedAgentId, {
        status: 'idle',
        currentTaskId: null,
        currentRunId: null
      })
    }
  }

  // -------------------------------------------------------- reconcile / tick

  /**
   * The orchestration heartbeat: derive task statuses, rollup usage, enforce
   * budgets, detect completion, then schedule what can run next. Called after
   * every task settle, lifecycle change and user edit.
   */
  private async reconcile(orchestrationId: string): Promise<void> {
    const orchestration = await this.store.getOrchestration(orchestrationId)
    if (!orchestration) return
    const tasks = await this.store.listTasks(orchestrationId)

    // 1. Derived task statuses (pending ⇄ ready ⇄ blocked).
    for (const [taskId, status] of this.scheduler.deriveStatuses(tasks)) {
      const task = tasks.find((item) => item.id === taskId)
      if (!task || task.status === status) continue
      await this.store.saveTask({ ...task, status })
      this.emit(orchestrationId, {
        type: status === 'blocked' ? 'task.blocked' : 'task.ready',
        timestamp: Date.now(),
        taskId
      })
    }
    const freshTasks = await this.store.listTasks(orchestrationId)

    // 2. Usage rollups from real runs.
    const runs = await this.host.listRunsByOrchestration(orchestrationId)
    const totalTokens = runs.reduce((sum, run) => sum + run.usage.totalTokens, 0)
    const costs = runs
      .map((run) => run.usage.estimatedCost)
      .filter((cost): cost is number => typeof cost === 'number')
    const estimatedCost = costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null
    const successCount = freshTasks.filter((task) => task.status === 'completed').length
    const failureCount = freshTasks.filter((task) => task.status === 'failed').length

    let next: HarnessOrchestrationRun = {
      ...orchestration,
      totalTokens,
      estimatedCost,
      successCount,
      failureCount,
      updatedAt: Date.now()
    }

    // 3. Budget enforcement — pause (never silently kill) when exceeded.
    if (next.status === 'running' && this.orchestrationBudgetExceeded(next)) {
      const reason =
        next.budget.maxTokens !== null && totalTokens >= next.budget.maxTokens
          ? `Token budget reached (${totalTokens} / ${next.budget.maxTokens})`
          : `Cost budget reached ($${estimatedCost ?? 0} / $${next.budget.maxCost})`
      next = {
        ...next,
        status: 'paused',
        pausedReason: reason
      }
      await this.store.saveOrchestration(next)
      this.emit(orchestrationId, {
        type: 'orchestration.paused',
        timestamp: Date.now(),
        orchestrationId,
        reason
      })
      return
    }

    // 4. Completion check — every task reached a terminal state.
    if (
      freshTasks.length > 0 &&
      freshTasks.every((task) => TERMINAL_TASK_STATUSES.has(task.status))
    ) {
      const failed = freshTasks.some((task) => task.status === 'failed')
      const evaluation = await this.buildFinalEvaluation(
        { ...next, status: failed ? 'failed' : 'completed' },
        freshTasks,
        runs
      )
      next = {
        ...next,
        status: failed ? 'failed' : 'completed',
        finishedAt: Date.now(),
        pausedReason: null
      }
      await this.store.saveOrchestration(next)
      await this.store.saveEvaluation(evaluation)
      this.emit(orchestrationId, {
        type: failed ? 'orchestration.failed' : 'orchestration.completed',
        timestamp: Date.now(),
        orchestrationId
      })
      return
    }

    await this.store.saveOrchestration(next)

    // 5. Schedule the next wave.
    if (next.status === 'running') {
      await this.tick(next, freshTasks)
    }
  }

  private async tick(
    orchestration: HarnessOrchestrationRun,
    tasks: readonly HarnessTask[]
  ): Promise<void> {
    const active = this.activeDispatches(orchestration.id)
    const snapshot: SchedulingSnapshot = {
      readyTaskIds: [],
      blocked: [],
      runningAgentIds: active.map((dispatch) => dispatch.agentId),
      runningRunCount: active.length,
      maxConcurrentAgents: orchestration.maxConcurrentAgents,
      maxConcurrentRuns: orchestration.maxConcurrentRuns
    }
    const candidates = this.scheduler.plan(orchestration, tasks, snapshot)
    for (const candidate of candidates) {
      await this.dispatchCandidate(orchestration, candidate)
    }
  }

  private orchestrationBudgetExceeded(orchestration: HarnessOrchestrationRun): boolean {
    if (
      orchestration.budget.maxTokens !== null &&
      orchestration.totalTokens >= orchestration.budget.maxTokens
    ) {
      return true
    }
    return (
      orchestration.budget.maxCost !== null &&
      orchestration.estimatedCost !== null &&
      orchestration.estimatedCost >= orchestration.budget.maxCost
    )
  }

  // -------------------------------------------------------- final evaluation

  /**
   * Deterministic orchestration evaluation over real evidence: task outcomes,
   * run outcomes, policy violations and file conflicts. No LLM judging.
   */
  private async buildFinalEvaluation(
    orchestration: HarnessOrchestrationRun,
    tasks: readonly HarnessTask[],
    runs: readonly HarnessRun[]
  ): Promise<HarnessOrchestrationEvaluation> {
    const agents = await this.store.listAgents(orchestration.id)
    const artifactGroups = await Promise.all(
      agents.map((agent) => this.host.artifactsForAgent(agent.id))
    )
    const artifacts = artifactGroups.flat()
    const conflicts = this.conflictService.detect(orchestration.id, artifacts)
    const policyViolations = this.policyViolations.get(orchestration.id) ?? 0
    const tasksCompleted = tasks.filter((task) => task.status === 'completed').length
    const tasksFailed = tasks.filter((task) => task.status === 'failed').length
    const runsSucceeded = runs.filter((run) => run.status === 'success').length
    const runsFailed = runs.filter(
      (run) => run.status === 'failed' || run.status === 'aborted'
    ).length
    const rejectedReviews = tasks.filter((task) => task.reviewVerdict === 'rejected').length

    const checks: HarnessEvaluationCheck[] = [
      {
        id: `${orchestration.id}:tasks`,
        name: 'Task completion',
        status:
          tasksFailed === 0 && tasksCompleted === tasks.length
            ? 'passed'
            : tasksFailed > 0
              ? 'failed'
              : 'warning',
        message: `${tasksCompleted}/${tasks.length} tasks completed, ${tasksFailed} failed`,
        evidence: tasks
          .map((task) => `${task.status === 'completed' ? '✓' : '✗'} ${task.title}`)
          .join('\n')
      },
      {
        id: `${orchestration.id}:runs`,
        name: 'Run outcomes',
        status: runsFailed === 0 ? 'passed' : 'warning',
        message: `${runsSucceeded} runs succeeded, ${runsFailed} failed or aborted (retries included)`
      },
      {
        id: `${orchestration.id}:policy`,
        name: 'Policy compliance',
        status: policyViolations === 0 ? 'passed' : 'failed',
        message:
          policyViolations === 0
            ? 'No policy violations during the orchestration'
            : `${policyViolations} policy-denied actions were blocked by the Harness policy engine`
      },
      {
        id: `${orchestration.id}:conflicts`,
        name: 'File conflicts',
        status: conflicts.conflicts.length === 0 ? 'passed' : 'warning',
        message:
          conflicts.conflicts.length === 0
            ? 'No files were modified by more than one agent'
            : `${conflicts.conflicts.length} files were modified by multiple agents`,
        evidence:
          conflicts.conflicts.length === 0
            ? undefined
            : conflicts.conflicts.map((file) => file.path).join('\n')
      },
      {
        id: `${orchestration.id}:reviews`,
        name: 'Review verdicts',
        status: rejectedReviews === 0 ? 'passed' : 'failed',
        message:
          rejectedReviews === 0
            ? 'All reviewed work was approved'
            : `${rejectedReviews} task(s) were rejected by their reviewer`
      },
      {
        id: `${orchestration.id}:budget`,
        name: 'Budget',
        status: this.orchestrationBudgetExceeded(orchestration) ? 'warning' : 'passed',
        message: `${orchestration.totalTokens} tokens${orchestration.estimatedCost !== null ? `, ~$${orchestration.estimatedCost.toFixed(2)}` : ''}`
      }
    ]

    const status = checks.some((check) => check.status === 'failed')
      ? 'failed'
      : checks.some((check) => check.status === 'warning')
        ? 'warning'
        : 'passed'

    return {
      orchestrationId: orchestration.id,
      evaluatedAt: Date.now(),
      status,
      tasksCompleted,
      tasksTotal: tasks.length,
      tasksFailed,
      runsSucceeded,
      runsFailed,
      policyViolations,
      criticalFailures: 0,
      checks
    }
  }

  // -------------------------------------------------------------- snapshot

  async snapshot(orchestrationId: string): Promise<HarnessOrchestrationSnapshot> {
    const orchestration = await this.requireOrchestration(orchestrationId)
    const [agents, tasks, handoffs, runs] = await Promise.all([
      this.store.listAgents(orchestrationId),
      this.store.listTasks(orchestrationId),
      this.store.listHandoffs(orchestrationId),
      this.host.listRunsByOrchestration(orchestrationId)
    ])

    const activeDispatches = this.activeDispatches(orchestrationId)
    const agentSnapshots = agents.map((agent) => {
      const agentRuns = runs.filter((run) => run.agentId === agent.id)
      const dispatch = activeDispatches.find((item) => item.agentId === agent.id)
      const lastEventAt = dispatch?.lastEventAt ?? null
      const possiblyStuck = dispatch !== undefined && Date.now() - dispatch.lastEventAt > STUCK_THRESHOLD_MS
      return {
        agent,
        runCount: agentRuns.length,
        totalTokens: agentRuns.reduce((sum, run) => sum + run.usage.totalTokens, 0),
        estimatedCost: sumCost(agentRuns),
        toolCalls: agentRuns.reduce((sum, run) => sum + run.toolCallCount, 0),
        failures: agentRuns.filter(
          (run) => run.status === 'failed' || run.status === 'aborted'
        ).length,
        lastEventAt,
        possiblyStuck
      }
    })

    const artifacts = (
      await Promise.all(agents.map((agent) => this.host.artifactsForAgent(agent.id)))
    ).flat()
    const conflicts = this.conflictService.detect(orchestrationId, artifacts)

    const totalCost = sumCost(runs)
    const costShares: HarnessAgentCostShare[] = agents.map((agent) => {
      const agentRuns = runs.filter((run) => run.agentId === agent.id)
      const cost = sumCost(agentRuns)
      return {
        agentId: agent.id,
        name: agent.name,
        role: agent.role,
        runCount: agentRuns.length,
        totalTokens: agentRuns.reduce((sum, run) => sum + run.usage.totalTokens, 0),
        estimatedCost: cost,
        toolCalls: agentRuns.reduce((sum, run) => sum + run.toolCallCount, 0),
        failures: agentRuns.filter(
          (run) => run.status === 'failed' || run.status === 'aborted'
        ).length,
        costPercent:
          totalCost !== null && cost !== null && totalCost > 0
            ? Math.round((cost / totalCost) * 100)
            : null
      }
    })

    const evaluation =
      (orchestration.status === 'completed' || orchestration.status === 'failed'
        ? await this.store.getEvaluation(orchestrationId)
        : null) ??
      (orchestration.status === 'completed' || orchestration.status === 'failed'
        ? await this.buildFinalEvaluation(orchestration, tasks, runs)
        : null)

    return {
      orchestration,
      agents: agentSnapshots,
      tasks,
      handoffs,
      conflicts,
      costShares,
      evaluation,
      timeline: this.host.getOrchestrationTimeline(orchestrationId),
      budgetExceeded: this.orchestrationBudgetExceeded(orchestration)
    }
  }

  async listHandoffs(orchestrationId?: string): Promise<AgentHandoff[]> {
    return this.store.listHandoffs(orchestrationId)
  }

  // ----------------------------------------------------------- stuck watch

  private checkStuck(): void {
    const now = Date.now()
    for (const dispatch of this.sessionDispatches.values()) {
      if (dispatch.notifiedStuck) continue
      if (now - dispatch.lastEventAt < STUCK_THRESHOLD_MS) continue
      dispatch.notifiedStuck = true
      this.emit(dispatch.orchestrationId, {
        type: 'agent.waiting',
        timestamp: Date.now(),
        agentId: dispatch.agentId,
        taskId: dispatch.taskId,
        reason: 'no events for 10 minutes — possibly stuck'
      })
    }
  }

  // --------------------------------------------------------------- helpers

  private emit(orchestrationId: string, event: HarnessEvent): void {
    if (!orchestrationId) return
    this.host.emitOrchestrationEvent(orchestrationId, event)
  }

  private emitAgentEvent(
    agent: HarnessAgent,
    kind: 'agent.created' | 'agent.assigned' | 'agent.started' | 'agent.waiting' | 'agent.completed' | 'agent.failed',
    extra?: Record<string, unknown>
  ): void {
    const base = { timestamp: Date.now(), agentId: agent.id, name: agent.name }
    let event: HarnessEvent
    switch (kind) {
      case 'agent.assigned':
        event = { type: kind, ...base, ...(extra as { taskId: string }) }
        break
      case 'agent.started':
        event = { type: kind, ...base, ...(extra as { taskId: string; runId: string }) }
        break
      case 'agent.waiting':
        event = {
          type: kind,
          ...base,
          ...(extra as { taskId: string; reason?: string })
        }
        break
      case 'agent.completed':
      case 'agent.failed':
        event = { type: kind, ...base, ...(extra as { taskId: string; runId?: string }) }
        break
      default:
        event = { type: kind, ...base }
    }
    this.emit(agent.orchestrationId ?? '', event)
  }

  private activeDispatches(orchestrationId: string): PendingDispatch[] {
    return [...this.sessionDispatches.values()].filter(
      (dispatch) => dispatch.orchestrationId === orchestrationId
    )
  }

  private clearDispatch(dispatch: PendingDispatch): void {
    if (this.sessionDispatches.get(dispatch.sessionId) === dispatch) {
      this.sessionDispatches.delete(dispatch.sessionId)
    }
    if (dispatch.runId && this.runDispatches.get(dispatch.runId) === dispatch) {
      this.runDispatches.delete(dispatch.runId)
    }
  }

  private async agentUsage(
    agentId: string,
    orchestrationId: string | null
  ): Promise<{ totalTokens: number; estimatedCost: number | null }> {
    if (!orchestrationId) return { totalTokens: 0, estimatedCost: null }
    const runs = await this.host.listRunsByOrchestration(orchestrationId)
    const agentRuns = runs.filter((run) => run.agentId === agentId)
    return {
      totalTokens: agentRuns.reduce((sum, run) => sum + run.usage.totalTokens, 0),
      estimatedCost: sumCost(agentRuns)
    }
  }

  private async addTaskToOrchestration(
    orchestration: HarnessOrchestrationRun,
    taskId: string
  ): Promise<void> {
    if (orchestration.taskIds.includes(taskId)) return
    await this.store.saveOrchestration({
      ...orchestration,
      taskIds: [...orchestration.taskIds, taskId],
      updatedAt: Date.now()
    })
  }

  private async validateTaskGraph(
    orchestrationId: string,
    dependencies: string[],
    parentTaskId: string | null,
    selfId?: string
  ): Promise<void> {
    const tasks = await this.store.listTasks(orchestrationId)
    const existing = tasks.filter((task) => task.id !== selfId)
    const ids = new Set(existing.map((task) => task.id))
    for (const dependency of dependencies) {
      if (!ids.has(dependency)) {
        throw new HarnessError(
          'TASK_NOT_FOUND',
          `Dependency refers to an unknown task: ${dependency}`
        )
      }
      if (dependency === selfId) {
        throw new HarnessError(
          'DEPENDENCY_CYCLE',
          'A task cannot depend on itself.'
        )
      }
    }
    if (parentTaskId && !ids.has(parentTaskId)) {
      throw new HarnessError(
        'TASK_NOT_FOUND',
        `Parent task not found: ${parentTaskId}`
      )
    }
    const projected = [
      ...existing,
      {
        ...(tasks.find((task) => task.id === selfId) ?? {
          id: 'new',
          orchestrationId,
          projectId: null,
          title: 'new',
          description: null,
          status: 'pending',
          priority: 'normal',
          assignedAgentId: null,
          parentTaskId,
          dependencies,
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
          createdAt: 0,
          startedAt: null,
          finishedAt: null
        }),
        dependencies
      }
    ] as HarnessTask[]
    const cycles = detectCycles(projected)
    if (cycles.length) {
      throw new HarnessError(
        'DEPENDENCY_CYCLE',
        `Dependency cycle detected: ${cycles.map((cycle) => cycle.join(' → ')).join('; ')}`
      )
    }
  }

  private async requireOrchestration(id: string): Promise<HarnessOrchestrationRun> {
    const orchestration = await this.store.getOrchestration(id)
    if (!orchestration) {
      throw new HarnessError('ORCHESTRATION_NOT_FOUND', `Orchestration not found: ${id}`)
    }
    return orchestration
  }

  private async requireTask(taskId: string): Promise<HarnessTask> {
    const task = await this.store.getTask(taskId)
    if (!task) {
      throw new HarnessError('TASK_NOT_FOUND', `Task not found: ${taskId}`)
    }
    return task
  }

  private async requireAgent(agentId: string): Promise<HarnessAgent> {
    const agent = await this.store.getAgent(agentId)
    if (!agent) {
      throw new HarnessError('AGENT_NOT_FOUND', `Agent not found: ${agentId}`)
    }
    return agent
  }

  private async requireTemplate(templateId: string): Promise<AgentTemplate> {
    const template = await this.store.getTemplate(templateId)
    if (!template) {
      throw new HarnessError('TEMPLATE_NOT_FOUND', `Template not found: ${templateId}`)
    }
    return template
  }
}

function clampConcurrency(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_MAX_CONCURRENT
  return Math.min(10, Math.max(1, Math.floor(value)))
}

function sumCost(runs: readonly HarnessRun[]): number | null {
  const costs = runs
    .map((run) => run.usage.estimatedCost)
    .filter((cost): cost is number => typeof cost === 'number')
  return costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
