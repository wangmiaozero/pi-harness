/**
 * Team Service.
 *
 * Teams are ordered lists of agent templates. A few focused presets ship
 * built-in; users create, duplicate and edit their own. No organizational
 * permissions — a team is a roster, nothing more.
 */

import type { AgentTemplate, HarnessTeam } from '@shared/types/harness'
import { newTeamId, newTemplateId, type OrchestrationStore } from './orchestration-store'

export interface TemplateInput {
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
}

export interface TeamInput {
  name: string
  description?: string | null
  agentTemplateIds: string[]
}

export const BUILTIN_TEMPLATE_ROLES = [
  'architect',
  'frontend',
  'backend',
  'qa',
  'reviewer'
] as const

export class TeamService {
  constructor(private readonly store: OrchestrationStore) {}

  // -------------------------------------------------------------- templates

  async listTemplates(): Promise<AgentTemplate[]> {
    return this.store.listTemplates()
  }

  async getTemplate(id: string): Promise<AgentTemplate | null> {
    return this.store.getTemplate(id)
  }

  async createTemplate(input: TemplateInput): Promise<AgentTemplate> {
    const now = Date.now()
    const template: AgentTemplate = {
      id: newTemplateId(),
      name: input.name.trim(),
      role: input.role.trim(),
      description: input.description ?? null,
      systemPrompt: input.systemPrompt ?? null,
      provider: input.provider ?? null,
      modelId: input.modelId ?? null,
      thinkingLevel: input.thinkingLevel ?? null,
      toolNames: input.toolNames ?? null,
      skillIds: input.skillIds ?? [],
      workspaceMode: input.workspaceMode ?? 'shared',
      isReviewer: input.isReviewer ?? input.role.trim().toLowerCase() === 'reviewer',
      createdAt: now,
      updatedAt: now
    }
    if (!template.name || !template.role) {
      throw new Error('Template name and role are required')
    }
    await this.store.saveTemplate(template)
    return template
  }

  async updateTemplate(id: string, input: TemplateInput): Promise<AgentTemplate> {
    const existing = await this.store.getTemplate(id)
    if (!existing) throw new Error(`Template not found: ${id}`)
    const next: AgentTemplate = {
      ...existing,
      name: input.name.trim(),
      role: input.role.trim(),
      description: input.description ?? null,
      systemPrompt: input.systemPrompt ?? null,
      provider: input.provider ?? null,
      modelId: input.modelId ?? null,
      thinkingLevel: input.thinkingLevel ?? null,
      toolNames: input.toolNames ?? null,
      skillIds: input.skillIds ?? [],
      workspaceMode: input.workspaceMode ?? existing.workspaceMode,
      isReviewer: input.isReviewer ?? false,
      updatedAt: Date.now()
    }
    await this.store.saveTemplate(next)
    return next
  }

  async duplicateTemplate(id: string): Promise<AgentTemplate> {
    const existing = await this.store.getTemplate(id)
    if (!existing) throw new Error(`Template not found: ${id}`)
    const now = Date.now()
    const copy: AgentTemplate = {
      ...existing,
      id: newTemplateId(),
      name: `${existing.name} (copy)`,
      createdAt: now,
      updatedAt: now
    }
    await this.store.saveTemplate(copy)
    return copy
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.store.deleteTemplate(id)
  }

  // ------------------------------------------------------------------ teams

  async listTeams(): Promise<HarnessTeam[]> {
    return this.store.listTeams()
  }

  async getTeam(id: string): Promise<HarnessTeam | null> {
    return this.store.getTeam(id)
  }

  async createTeam(input: TeamInput): Promise<HarnessTeam> {
    const now = Date.now()
    const team: HarnessTeam = {
      id: newTeamId(),
      name: input.name.trim(),
      description: input.description ?? null,
      agentTemplateIds: [...input.agentTemplateIds],
      createdAt: now,
      updatedAt: now
    }
    if (!team.name) throw new Error('Team name is required')
    await this.store.saveTeam(team)
    return team
  }

  async updateTeam(id: string, input: TeamInput): Promise<HarnessTeam> {
    const existing = await this.store.getTeam(id)
    if (!existing) throw new Error(`Team not found: ${id}`)
    const next: HarnessTeam = {
      ...existing,
      name: input.name.trim(),
      description: input.description ?? null,
      agentTemplateIds: [...input.agentTemplateIds],
      updatedAt: Date.now()
    }
    await this.store.saveTeam(next)
    return next
  }

  async duplicateTeam(id: string): Promise<HarnessTeam> {
    const existing = await this.store.getTeam(id)
    if (!existing) throw new Error(`Team not found: ${id}`)
    const now = Date.now()
    const copy: HarnessTeam = {
      ...existing,
      id: newTeamId(),
      name: `${existing.name} (copy)`,
      createdAt: now,
      updatedAt: now
    }
    await this.store.saveTeam(copy)
    return copy
  }

  async deleteTeam(id: string): Promise<void> {
    await this.store.deleteTeam(id)
  }

  // ---------------------------------------------------------------- presets

  /** Built-in team presets: focused, not a zoo. Templates are materialized on first use. */
  async ensureBuiltinPresets(): Promise<void> {
    const teams = await this.store.listTeams()
    const byName = new Map(teams.map((team) => [team.name, team]))
    const templates = await this.store.listTemplates()
    const byRole = new Map(templates.map((template) => [template.role, template]))

    const ensureTemplate = async (
      role: (typeof BUILTIN_TEMPLATE_ROLES)[number]
    ): Promise<string> => {
      const existing = byRole.get(role)
      if (existing) return existing.id
      const created = await this.createTemplate({
        name: presetTemplateName(role),
        role,
        description: presetTemplateDescription(role),
        isReviewer: role === 'reviewer',
        workspaceMode: role === 'reviewer' ? 'shared' : 'worktree'
      })
      byRole.set(role, created)
      return created.id
    }

    const presets: Array<{ name: string; roles: Array<(typeof BUILTIN_TEMPLATE_ROLES)[number]> }> = [
      { name: 'Solo', roles: ['backend'] },
      { name: 'Developer + Reviewer', roles: ['backend', 'reviewer'] },
      { name: 'Frontend + Backend + Reviewer', roles: ['frontend', 'backend', 'reviewer'] },
      { name: 'Architect + Frontend + Backend + QA + Reviewer', roles: ['architect', 'frontend', 'backend', 'qa', 'reviewer'] }
    ]

    for (const preset of presets) {
      if (byName.has(preset.name)) continue
      const templateIds = await Promise.all(preset.roles.map((role) => ensureTemplate(role)))
      await this.createTeam({ name: preset.name, agentTemplateIds: templateIds })
    }
  }
}

function presetTemplateName(role: string): string {
  switch (role) {
    case 'architect':
      return 'Architect'
    case 'frontend':
      return 'Frontend Engineer'
    case 'backend':
      return 'Backend Engineer'
    case 'qa':
      return 'QA Engineer'
    case 'reviewer':
      return 'Reviewer'
    default:
      return role
  }
}

function presetTemplateDescription(role: string): string | null {
  switch (role) {
    case 'architect':
      return 'Plans the design and decomposes the work before implementation.'
    case 'frontend':
      return 'Implements user-facing interfaces and client logic.'
    case 'backend':
      return 'Implements services, APIs and core logic.'
    case 'qa':
      return 'Runs tests and verifies the implementation against requirements.'
    case 'reviewer':
      return 'Reviews artifacts, diffs and evaluations; returns a verdict.'
    default:
      return null
  }
}
