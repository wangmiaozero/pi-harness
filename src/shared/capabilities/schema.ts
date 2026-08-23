import { z } from 'zod'
import { CAPABILITY_SOURCES, CAPABILITY_TYPES } from './types'

const capabilityIdRegex = /^[a-z0-9][a-z0-9._-]{0,127}$/

export const capabilityIdSchema = z.string().regex(capabilityIdRegex)

const capabilityInstallSchema = z.object({
  strategy: z.literal('skills-cli'),
  selector: capabilityIdSchema,
  target: z.literal('pi-global')
})

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
    tags: z.array(z.string().min(1).max(64)).max(32).optional(),
    useCases: z.array(z.string().min(1).max(64)).max(16).optional(),
    capabilities: z
      .object({
        planning: z.boolean().optional(),
        codeReview: z.boolean().optional(),
        debugging: z.boolean().optional(),
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
    if (definition.install && definition.type !== 'skill') {
      context.addIssue({
        code: 'custom',
        path: ['install'],
        message: 'skills-cli installation is available only to skill capabilities'
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
