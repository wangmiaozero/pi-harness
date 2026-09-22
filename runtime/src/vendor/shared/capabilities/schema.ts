// @ts-nocheck
import { z } from 'zod'
import {
  CAPABILITY_CATEGORIES,
  CAPABILITY_INTEGRATIONS,
  CAPABILITY_SOURCES,
  CAPABILITY_TYPES
} from './types.js'

const capabilityIdRegex = /^[a-z0-9][a-z0-9._-]{0,127}$/

export const capabilityIdSchema = z.string().regex(capabilityIdRegex)

const capabilityInstallSchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('skills-cli'),
    selector: capabilityIdSchema,
    target: z.literal('pi-global')
  }),
  z.object({
    strategy: z.literal('pi-package'),
    source: z.string().regex(/^git:github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
    target: z.literal('pi-global')
  })
])

export const capabilityDefinitionSchema = z
  .object({
    id: capabilityIdSchema,
    type: z.enum(CAPABILITY_TYPES),
    name: z.string().min(1).max(128),
    description: z.string().max(500).optional(),
    version: z.string().min(1).max(128).optional(),
    source: z.enum(CAPABILITY_SOURCES),
    sourceUrl: z.url().max(1024).optional(),
    builtin: z.boolean().optional(),
    featured: z.boolean().optional(),
    recommended: z.boolean().optional(),
    optional: z.boolean().optional(),
    category: z.enum(CAPABILITY_CATEGORIES).optional(),
    integration: z.enum(CAPABILITY_INTEGRATIONS).optional(),
    order: z.number().int().min(0).max(10_000).optional(),
    tags: z.array(z.string().min(1).max(64)).max(32).optional(),
    useCases: z.array(z.string().min(1).max(64)).max(16).optional(),
    capabilities: z
      .object({
        brainstorming: z.boolean().optional(),
        planning: z.boolean().optional(),
        tdd: z.boolean().optional(),
        codeReview: z.boolean().optional(),
        debugging: z.boolean().optional(),
        systematicDebugging: z.boolean().optional(),
        worktrees: z.boolean().optional(),
        subagentWorkflow: z.boolean().optional(),
        parallelAgentWorkflow: z.boolean().optional(),
        verification: z.boolean().optional(),
        browser: z.boolean().optional(),
        filesystem: z.boolean().optional(),
        git: z.boolean().optional(),
        terminal: z.boolean().optional(),
        search: z.boolean().optional()
      })
      .optional(),
    install: capabilityInstallSchema.optional(),
    members: z.array(capabilityIdSchema).max(64).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .superRefine((definition, context) => {
    if (definition.install?.strategy === 'skills-cli' && definition.type !== 'skill') {
      context.addIssue({
        code: 'custom',
        path: ['install'],
        message: 'skills-cli installation is available only to skill capabilities'
      })
    }
    if (definition.install?.strategy === 'pi-package' && definition.type !== 'package') {
      context.addIssue({
        code: 'custom',
        path: ['install'],
        message: 'pi-package installation is available only to package capabilities'
      })
    }
    if (definition.builtin && definition.install) {
      context.addIssue({
        code: 'custom',
        path: ['install'],
        message: 'Built-in capabilities cannot declare an installer'
      })
    }
    if (
      definition.source === 'github' &&
      !definition.sourceUrl?.startsWith('https://github.com/')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceUrl'],
        message: 'GitHub capabilities require an HTTPS github.com source URL'
      })
    }
  })

export const capabilityMutationSchema = z
  .object({
    skillId: capabilityIdSchema
  })
  .strict()

export const capabilityToggleSchema = z
  .object({
    skillId: capabilityIdSchema,
    enabled: z.boolean()
  })
  .strict()
