/**
 * Agent Manager.
 *
 * Lifecycle of concrete HarnessAgents: instantiation from templates or ad-hoc
 * definitions, workspace binding (shared or isolated git worktree), status
 * transitions and cost rollups. Agents never run themselves — the orchestrator
 * dispatches them onto real Pi sessions.
 */

import type {
  AgentTemplate,
  HarnessAgent,
  HarnessAgentStatus,
  HarnessOrchestrationRun
} from '../harness-control/types.js'
import { newAgentId, type OrchestrationStore } from './store.js'

export interface AgentDefinition {
  name: string
  role: string
  description?: string | null
  provider?: string | null
  modelId?: string | null
  thinkingLevel?: string | null
  systemPrompt?: string | null
  toolNames?: string[] | null
  skillIds?: string[]
  isReviewer?: boolean
  workspaceMode?: HarnessAgent['workspaceMode']
  budget?: HarnessAgent['budget']
}

export interface AgentManagerHooks {
  /** Ensure the agent's session can write inside its workspace folders. */
  bindSession: (sessionId: string, cwd: string) => Promise<void>
  /** Create an isolated worktree for an agent. */
  createWorktree: (cwd: string, branch: string) => Promise<{ path: string; branch: string }>
  emitAgentEvent: (
    agent: HarnessAgent,
    event: HarnessEventKind,
    extra?: Record<string, unknown>
  ) => void
}

export type HarnessEventKind =
  | 'agent.created'
  | 'agent.assigned'
  | 'agent.started'
  | 'agent.waiting'
  | 'agent.completed'
  | 'agent.failed'

export class AgentManager {
  constructor(
    private readonly store: OrchestrationStore,
    private readonly hooks: AgentManagerHooks
  ) {}

  async instantiate(
    orchestration: HarnessOrchestrationRun,
    definition: AgentDefinition,
    templateId: string | null = null
  ): Promise<HarnessAgent> {
    const now = Date.now()
    const agent: HarnessAgent = {
      id: newAgentId(),
      orchestrationId: orchestration.id,
      templateId,
      name: definition.name,
      role: definition.role,
      description: definition.description ?? null,
      status: 'idle',
      provider: definition.provider ?? null,
      modelId: definition.modelId ?? null,
      thinkingLevel: definition.thinkingLevel ?? null,
      systemPrompt: definition.systemPrompt ?? null,
      toolNames: definition.toolNames ?? null,
      skillIds: definition.skillIds ?? [],
      isReviewer: definition.isReviewer ?? false,
      budget: definition.budget ?? { maxCost: null, maxTokens: null },
      sessionId: null,
      cwd: orchestration.cwd,
      workspaceMode: definition.workspaceMode ?? 'shared',
      worktreePath: null,
      worktreeBranch: null,
      currentTaskId: null,
      currentRunId: null,
      createdAt: now,
      updatedAt: now
    }
    await this.store.saveAgent(agent)
    await this.addAgentToOrchestration(orchestration, agent.id)
    this.hooks.emitAgentEvent(agent, 'agent.created')
    return agent
  }

  async fromTemplate(
    orchestration: HarnessOrchestrationRun,
    template: AgentTemplate
  ): Promise<HarnessAgent> {
    return this.instantiate(
      orchestration,
      {
        name: template.name,
        role: template.role,
        description: template.description,
        provider: template.provider,
        modelId: template.modelId,
        thinkingLevel: template.thinkingLevel,
        systemPrompt: template.systemPrompt,
        toolNames: template.toolNames,
        skillIds: template.skillIds,
        isReviewer: template.isReviewer,
        workspaceMode: template.workspaceMode
      },
      template.id
    )
  }

  async setBudget(agentId: string, budget: HarnessAgent['budget']): Promise<HarnessAgent> {
    return this.update(agentId, { budget })
  }

  async update(agentId: string, patch: Partial<HarnessAgent>): Promise<HarnessAgent> {
    const agent = await this.store.getAgent(agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)
    const next: HarnessAgent = { ...agent, ...patch, updatedAt: Date.now() }
    await this.store.saveAgent(next)
    return next
  }

  async setStatus(agentId: string, status: HarnessAgentStatus): Promise<HarnessAgent> {
    return this.update(agentId, { status })
  }

  async assignTask(agentId: string, taskId: string): Promise<void> {
    await this.update(agentId, { currentTaskId: taskId, status: 'queued' })
    const agent = await this.store.getAgent(agentId)
    if (agent) this.hooks.emitAgentEvent(agent, 'agent.assigned', { taskId })
  }

  /** Bind the agent to a live session (real runs, never mocked). */
  async bindSession(agentId: string, sessionId: string): Promise<void> {
    await this.update(agentId, { sessionId })
    const agent = await this.store.getAgent(agentId)
    if (!agent) return
    const cwd = agent.worktreePath ?? agent.cwd ?? null
    if (cwd) await this.hooks.bindSession(sessionId, cwd)
  }

  /**
   * Prepare the agent's workspace. Shared mode uses the orchestration cwd;
   * worktree mode creates an isolated git worktree branch.
   */
  async prepareWorkspace(agentId: string): Promise<HarnessAgent> {
    const agent = await this.store.getAgent(agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)
    if (agent.workspaceMode !== 'worktree' || !agent.cwd || agent.worktreePath) {
      return agent
    }
    const branch = sanitizeBranch(`pi-harness/${agent.role}/${shortId(agent.id)}`)
    const worktree = await this.hooks.createWorktree(agent.cwd, branch)
    return this.update(agentId, {
      worktreePath: worktree.path,
      worktreeBranch: worktree.branch
    })
  }

  async listAgents(orchestrationId?: string): Promise<HarnessAgent[]> {
    return this.store.listAgents(orchestrationId)
  }

  async getAgent(agentId: string): Promise<HarnessAgent | null> {
    return this.store.getAgent(agentId)
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.store.deleteAgent(agentId)
  }

  private async addAgentToOrchestration(
    orchestration: HarnessOrchestrationRun,
    agentId: string
  ): Promise<void> {
    if (orchestration.agentIds.includes(agentId)) return
    const next: HarnessOrchestrationRun = {
      ...orchestration,
      agentIds: [...orchestration.agentIds, agentId],
      updatedAt: Date.now()
    }
    await this.store.saveOrchestration(next)
  }
}

function sanitizeBranch(branch: string): string {
  return branch
    .replace(/[^a-zA-Z0-9/_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

function shortId(id: string): string {
  return id.slice(-8)
}
