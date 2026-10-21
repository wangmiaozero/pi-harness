import { z } from 'zod'
import semver from 'semver'
import { HARNESS_PLUGIN_API_VERSION, PLUGIN_EVENT_TYPES } from './index.mjs'
const portableName = (value) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
const pluginIdSchema = z
  .string()
  .min(3)
  .max(100)
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/)
  .refine(portableName, 'Reserved device name')
const key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
const text = z.string().trim().min(1).max(500)
const version = z
  .string()
  .max(64)
  .refine((v) => semver.valid(v) === v, 'Expected exact SemVer')
const permissionSchema = z.enum([
  'events:read',
  'evaluation:read',
  'trace:read',
  'teams:contribute'
])
const permissions = z
  .array(permissionSchema)
  .max(4)
  .refine((a) => new Set(a).size === a.length, 'Duplicate permission')
const contribution = z.strictObject({ id: key, version })
const teamTemplateSchema = contribution
  .extend({
    name: text,
    permissions: permissions.default([]),
    agents: z
      .array(
        z.strictObject({
          key,
          name: text,
          role: key,
          description: text.optional(),
          workspaceMode: z.enum(['shared', 'worktree']).default('shared'),
          isReviewer: z.boolean().default(false)
        })
      )
      .min(1)
      .max(16),
    tasks: z
      .array(
        z.strictObject({
          key,
          title: text,
          description: z.string().min(1).max(4e3),
          agent: key,
          dependencies: z.array(key).max(64).default([]),
          reviewRequired: z.boolean().default(false)
        })
      )
      .min(1)
      .max(64)
  })
  .superRefine((team, ctx) => {
    const agents = new Set(team.agents.map((a) => a.key)),
      tasks = new Map(team.tasks.map((t) => [t.key, t]))
    if (agents.size !== team.agents.length || tasks.size !== team.tasks.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate agent or task key' })
    const visiting = new Set(),
      visited = new Set()
    function visit(id) {
      if (visiting.has(id)) return false
      if (visited.has(id)) return true
      const task = tasks.get(id)
      if (!task) return false
      visiting.add(id)
      for (const dep of task.dependencies) if (!visit(dep)) return false
      visiting.delete(id)
      visited.add(id)
      return true
    }
    for (const task of team.tasks) {
      if (
        !agents.has(task.agent) ||
        !visit(task.key) ||
        new Set(task.dependencies).size !== task.dependencies.length
      )
        ctx.addIssue({ code: 'custom', message: 'Invalid agent, dependency or task cycle' })
    }
    if (team.tasks.some((t) => t.reviewRequired) && !team.agents.some((a) => a.isReviewer))
      ctx.addIssue({ code: 'custom', message: 'Review tasks require a reviewer agent' })
  })
const pluginManifestSchema = z
  .strictObject({
    id: pluginIdSchema,
    name: text,
    version,
    apiVersion: z
      .string()
      .min(1)
      .max(100)
      .refine((v) => semver.validRange(v) !== null, 'Invalid API version range'),
    description: text,
    author: text,
    entry: z
      .string()
      .max(100)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.mjs$/)
      .refine(portableName, 'Reserved device name')
      .nullable()
      .default(null),
    permissions: permissions.default([]),
    contributions: z
      .strictObject({
        events: z.array(z.enum(PLUGIN_EVENT_TYPES)).max(5).default([]),
        evaluators: z.array(contribution).max(8).default([]),
        exporters: z.array(contribution).max(8).default([]),
        teams: z.array(teamTemplateSchema).max(8).default([])
      })
      .default({ events: [], evaluators: [], exporters: [], teams: [] })
  })
  .superRefine((m, ctx) => {
    const required = [
      m.contributions.events.length && 'events:read',
      m.contributions.evaluators.length && 'evaluation:read',
      m.contributions.exporters.length && 'trace:read',
      m.contributions.teams.length && 'teams:contribute'
    ].filter(Boolean)
    if (required.some((p) => !m.permissions.includes(p)))
      ctx.addIssue({ code: 'custom', message: 'Contribution permission missing' })
    if (
      !m.entry &&
      (m.contributions.events.length ||
        m.contributions.evaluators.length ||
        m.contributions.exporters.length)
    )
      ctx.addIssue({ code: 'custom', message: 'Executable contributions require an entry' })
    for (const list of [
      m.contributions.evaluators,
      m.contributions.exporters,
      m.contributions.teams
    ])
      if (new Set(list.map((c) => c.id)).size !== list.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate contribution id' })
    if (m.contributions.teams.some((t) => t.permissions.some((p) => !m.permissions.includes(p))))
      ctx.addIssue({ code: 'custom', message: 'Template permission not declared' })
  })
function compatible(manifest) {
  return semver.satisfies(HARNESS_PLUGIN_API_VERSION, manifest.apiVersion)
}
export { compatible, permissionSchema, pluginIdSchema, pluginManifestSchema, teamTemplateSchema }
