/**
 * Orchestration Store.
 *
 * Persistence seam for Multi-Agent Orchestration records: agent templates,
 * teams, orchestration runs, concrete agents, tasks and handoffs. Everything
 * lives in one atomic JSON store with schema-versioned defaults so restarts
 * recover the full orchestration graph.
 */

import { randomUUID } from 'node:crypto'
import type { JsonStore } from '../../services/storage'
import type {
  AgentHandoff,
  AgentTemplate,
  HarnessAgent,
  HarnessOrchestrationEvaluation,
  HarnessOrchestrationRun,
  HarnessTask,
  HarnessTeam
} from '@shared/types/harness'

const MAX_RECORDS = 200

export interface OrchestrationStoreRecord {
  schemaVersion: 1
  templates: AgentTemplate[]
  teams: HarnessTeam[]
  orchestrations: HarnessOrchestrationRun[]
  agents: HarnessAgent[]
  tasks: HarnessTask[]
  handoffs: AgentHandoff[]
  evaluations: HarnessOrchestrationEvaluation[]
}

export const EMPTY_ORCHESTRATION_STORE: OrchestrationStoreRecord = {
  schemaVersion: 1,
  templates: [],
  teams: [],
  orchestrations: [],
  agents: [],
  tasks: [],
  handoffs: [],
  evaluations: []
}

function normalizeTemplate(template: AgentTemplate): AgentTemplate {
  return {
    ...template,
    skillIds: template.skillIds ?? [],
    toolNames: template.toolNames ?? null,
    isReviewer: template.isReviewer ?? false,
    workspaceMode: template.workspaceMode ?? 'shared',
    createdAt: template.createdAt ?? 0,
    updatedAt: template.updatedAt ?? 0
  }
}

function normalizeAgent(agent: HarnessAgent): HarnessAgent {
  return {
    ...agent,
    skillIds: agent.skillIds ?? [],
    isReviewer: agent.isReviewer ?? false,
    budget: agent.budget ?? { maxCost: null, maxTokens: null },
    sessionId: agent.sessionId ?? null,
    cwd: agent.cwd ?? null,
    worktreePath: agent.worktreePath ?? null,
    worktreeBranch: agent.worktreeBranch ?? null,
    currentTaskId: agent.currentTaskId ?? null,
    currentRunId: agent.currentRunId ?? null,
    orchestrationId: agent.orchestrationId ?? null,
    templateId: agent.templateId ?? null,
    thinkingLevel: agent.thinkingLevel ?? null,
    workspaceMode: agent.workspaceMode ?? 'shared'
  }
}

function normalizeTask(task: HarnessTask): HarnessTask {
  return {
    ...task,
    dependencies: task.dependencies ?? [],
    inputArtifactIds: task.inputArtifactIds ?? [],
    runIds: task.runIds ?? [],
    artifactIds: task.artifactIds ?? [],
    retryCount: task.retryCount ?? 0,
    reviewRequired: task.reviewRequired ?? false,
    reviewAgentId: task.reviewAgentId ?? null,
    reviewVerdict: task.reviewVerdict ?? null,
    reviewSummary: task.reviewSummary ?? null,
    error: task.error ?? null
  }
}

function normalizeOrchestration(run: HarnessOrchestrationRun): HarnessOrchestrationRun {
  return {
    ...run,
    taskIds: run.taskIds ?? [],
    agentIds: run.agentIds ?? [],
    maxConcurrentAgents: run.maxConcurrentAgents ?? 3,
    maxConcurrentRuns: run.maxConcurrentRuns ?? 3,
    budget: run.budget ?? { maxCost: null, maxTokens: null },
    totalTokens: run.totalTokens ?? 0,
    estimatedCost: run.estimatedCost ?? null,
    successCount: run.successCount ?? 0,
    failureCount: run.failureCount ?? 0,
    pausedReason: run.pausedReason ?? null,
    cwd: run.cwd ?? null,
    name: run.name ?? null,
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    strategy: run.strategy ?? 'dependency',
    updatedAt: run.updatedAt ?? run.createdAt ?? 0
  }
}

function normalizeHandoff(handoff: AgentHandoff): AgentHandoff {
  return {
    ...handoff,
    artifactIds: handoff.artifactIds ?? [],
    taskId: handoff.taskId ?? null,
    orchestrationId: handoff.orchestrationId ?? null,
    summary: handoff.summary ?? null
  }
}

function cap<T>(items: T[], max = MAX_RECORDS): T[] {
  return items.slice(0, max)
}

/** Repository over the persisted orchestration graph. */
export class OrchestrationStore {
  constructor(private readonly store: JsonStore<OrchestrationStoreRecord>) {}

  private async read(): Promise<OrchestrationStoreRecord> {
    const raw = await this.store.read()
    return {
      schemaVersion: 1,
      templates: (raw.templates ?? []).map(normalizeTemplate),
      teams: raw.teams ?? [],
      orchestrations: (raw.orchestrations ?? []).map(normalizeOrchestration),
      agents: (raw.agents ?? []).map(normalizeAgent),
      tasks: (raw.tasks ?? []).map(normalizeTask),
      handoffs: (raw.handoffs ?? []).map(normalizeHandoff),
      evaluations: raw.evaluations ?? []
    }
  }

  private async write(next: OrchestrationStoreRecord): Promise<void> {
    await this.store.write({
      schemaVersion: 1,
      templates: cap(next.templates),
      teams: cap(next.teams),
      orchestrations: cap(next.orchestrations),
      agents: cap(next.agents),
      tasks: cap(next.tasks, 500),
      handoffs: cap(next.handoffs),
      evaluations: cap(next.evaluations)
    })
  }

  /**
   * Write mutex. Every mutation is a read-modify-write over the whole record;
   * concurrent callers (event stream vs. user CRUD) would otherwise race and
   * drop each other's writes. All mutations are serialized through here.
   */
  private writeQueue: Promise<unknown> = Promise.resolve()

  private enqueueWrite<T>(op: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(op, op)
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  // ------------------------------------------------------------- templates

  async listTemplates(): Promise<AgentTemplate[]> {
    return (await this.read()).templates
  }

  async getTemplate(id: string): Promise<AgentTemplate | null> {
    return (await this.read()).templates.find((template) => template.id === id) ?? null
  }

  async saveTemplate(template: AgentTemplate): Promise<AgentTemplate> {
    return this.enqueueWrite(() => this.saveTemplateOp(template))
  }

  private async saveTemplateOp(template: AgentTemplate): Promise<AgentTemplate> {
    const record = await this.read()
    const next = record.templates.filter((item) => item.id !== template.id)
    next.unshift(template)
    await this.write({ ...record, templates: next })
    return template
  }

  async deleteTemplate(id: string): Promise<void> {
    return this.enqueueWrite(() => this.deleteTemplateOp(id))
  }

  private async deleteTemplateOp(id: string): Promise<void> {
    const record = await this.read()
    await this.write({
      ...record,
      templates: record.templates.filter((item) => item.id !== id),
      teams: record.teams.map((team) => ({
        ...team,
        agentTemplateIds: team.agentTemplateIds.filter((templateId) => templateId !== id)
      }))
    })
  }

  // ----------------------------------------------------------------- teams

  async listTeams(): Promise<HarnessTeam[]> {
    return (await this.read()).teams
  }

  async getTeam(id: string): Promise<HarnessTeam | null> {
    return (await this.read()).teams.find((team) => team.id === id) ?? null
  }

  async saveTeam(team: HarnessTeam): Promise<HarnessTeam> {
    return this.enqueueWrite(() => this.saveTeamOp(team))
  }

  private async saveTeamOp(team: HarnessTeam): Promise<HarnessTeam> {
    const record = await this.read()
    const next = record.teams.filter((item) => item.id !== team.id)
    next.unshift(team)
    await this.write({ ...record, teams: next })
    return team
  }

  async deleteTeam(id: string): Promise<void> {
    return this.enqueueWrite(() => this.deleteTeamOp(id))
  }

  private async deleteTeamOp(id: string): Promise<void> {
    const record = await this.read()
    await this.write({ ...record, teams: record.teams.filter((team) => team.id !== id) })
  }

  // -------------------------------------------------------- orchestrations

  async listOrchestrations(): Promise<HarnessOrchestrationRun[]> {
    return (await this.read()).orchestrations
  }

  async getOrchestration(id: string): Promise<HarnessOrchestrationRun | null> {
    return (await this.read()).orchestrations.find((run) => run.id === id) ?? null
  }

  async saveOrchestration(run: HarnessOrchestrationRun): Promise<HarnessOrchestrationRun> {
    return this.enqueueWrite(() => this.saveOrchestrationOp(run))
  }

  private async saveOrchestrationOp(
    run: HarnessOrchestrationRun
  ): Promise<HarnessOrchestrationRun> {
    const record = await this.read()
    const next = record.orchestrations.filter((item) => item.id !== run.id)
    next.unshift(run)
    await this.write({ ...record, orchestrations: next })
    return run
  }

  async deleteOrchestration(id: string): Promise<void> {
    return this.enqueueWrite(() => this.deleteOrchestrationOp(id))
  }

  private async deleteOrchestrationOp(id: string): Promise<void> {
    const record = await this.read()
    await this.write({
      ...record,
      orchestrations: record.orchestrations.filter((run) => run.id !== id),
      agents: record.agents.filter((agent) => agent.orchestrationId !== id),
      tasks: record.tasks.filter((task) => task.orchestrationId !== id),
      handoffs: record.handoffs.filter((handoff) => handoff.orchestrationId !== id)
    })
  }

  // --------------------------------------------------------------- agents

  async listAgents(orchestrationId?: string): Promise<HarnessAgent[]> {
    const agents = (await this.read()).agents
    return orchestrationId
      ? agents.filter((agent) => agent.orchestrationId === orchestrationId)
      : agents
  }

  async getAgent(id: string): Promise<HarnessAgent | null> {
    return (await this.read()).agents.find((agent) => agent.id === id) ?? null
  }

  async saveAgent(agent: HarnessAgent): Promise<HarnessAgent> {
    return this.enqueueWrite(() => this.saveAgentOp(agent))
  }

  private async saveAgentOp(agent: HarnessAgent): Promise<HarnessAgent> {
    const record = await this.read()
    const next = record.agents.filter((item) => item.id !== agent.id)
    next.unshift(agent)
    await this.write({ ...record, agents: next })
    return agent
  }

  async saveAgents(agents: HarnessAgent[]): Promise<void> {
    if (!agents.length) return
    return this.enqueueWrite(() => this.saveAgentsOp(agents))
  }

  private async saveAgentsOp(agents: HarnessAgent[]): Promise<void> {
    const record = await this.read()
    const byId = new Map(record.agents.map((item) => [item.id, item]))
    for (const agent of agents) byId.set(agent.id, agent)
    await this.write({ ...record, agents: [...byId.values()] })
  }

  async deleteAgent(id: string): Promise<void> {
    return this.enqueueWrite(() => this.deleteAgentOp(id))
  }

  private async deleteAgentOp(id: string): Promise<void> {
    const record = await this.read()
    await this.write({ ...record, agents: record.agents.filter((agent) => agent.id !== id) })
  }

  // ---------------------------------------------------------------- tasks

  async listTasks(orchestrationId?: string): Promise<HarnessTask[]> {
    const tasks = (await this.read()).tasks
    return orchestrationId
      ? tasks.filter((task) => task.orchestrationId === orchestrationId)
      : tasks
  }

  async getTask(id: string): Promise<HarnessTask | null> {
    return (await this.read()).tasks.find((task) => task.id === id) ?? null
  }

  async saveTask(task: HarnessTask): Promise<HarnessTask> {
    return this.enqueueWrite(() => this.saveTaskOp(task))
  }

  private async saveTaskOp(task: HarnessTask): Promise<HarnessTask> {
    const record = await this.read()
    const next = record.tasks.filter((item) => item.id !== task.id)
    next.unshift(task)
    await this.write({ ...record, tasks: next })
    return task
  }

  async saveTasks(tasks: HarnessTask[]): Promise<void> {
    if (!tasks.length) return
    return this.enqueueWrite(() => this.saveTasksOp(tasks))
  }

  private async saveTasksOp(tasks: HarnessTask[]): Promise<void> {
    const record = await this.read()
    const byId = new Map(record.tasks.map((item) => [item.id, item]))
    for (const task of tasks) byId.set(task.id, task)
    await this.write({ ...record, tasks: [...byId.values()] })
  }

  async deleteTask(id: string): Promise<void> {
    return this.enqueueWrite(() => this.deleteTaskOp(id))
  }

  private async deleteTaskOp(id: string): Promise<void> {
    const record = await this.read()
    await this.write({
      ...record,
      tasks: record.tasks
        .filter((task) => task.id !== id)
        .map((task) => ({
          ...task,
          dependencies: task.dependencies.filter((dependency) => dependency !== id),
          parentTaskId: task.parentTaskId === id ? null : task.parentTaskId
        }))
    })
  }

  // ------------------------------------------------------------- handoffs

  async listHandoffs(orchestrationId?: string): Promise<AgentHandoff[]> {
    const handoffs = (await this.read()).handoffs
    return orchestrationId
      ? handoffs.filter((handoff) => handoff.orchestrationId === orchestrationId)
      : handoffs
  }

  async saveHandoff(handoff: AgentHandoff): Promise<AgentHandoff> {
    return this.enqueueWrite(() => this.saveHandoffOp(handoff))
  }

  private async saveHandoffOp(handoff: AgentHandoff): Promise<AgentHandoff> {
    const record = await this.read()
    const next = record.handoffs.filter((item) => item.id !== handoff.id)
    next.unshift(handoff)
    await this.write({ ...record, handoffs: next })
    return handoff
  }

  // ----------------------------------------------------------- evaluations

  async getEvaluation(orchestrationId: string): Promise<HarnessOrchestrationEvaluation | null> {
    return (
      (await this.read()).evaluations.find((item) => item.orchestrationId === orchestrationId) ??
      null
    )
  }

  async saveEvaluation(evaluation: HarnessOrchestrationEvaluation): Promise<void> {
    return this.enqueueWrite(() => this.saveEvaluationOp(evaluation))
  }

  private async saveEvaluationOp(evaluation: HarnessOrchestrationEvaluation): Promise<void> {
    const record = await this.read()
    const next = record.evaluations.filter(
      (item) => item.orchestrationId !== evaluation.orchestrationId
    )
    next.unshift(evaluation)
    await this.write({ ...record, evaluations: next })
  }
}

export function newOrchestrationId(): string {
  return `orch-${randomUUID()}`
}

export function newAgentId(): string {
  return `agent-${randomUUID()}`
}

export function newTaskId(): string {
  return `task-${randomUUID()}`
}

export function newTemplateId(): string {
  return `tpl-${randomUUID()}`
}

export function newTeamId(): string {
  return `team-${randomUUID()}`
}

export function newHandoffId(): string {
  return `ho-${randomUUID()}`
}
