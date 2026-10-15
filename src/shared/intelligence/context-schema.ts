import { z } from 'zod'
import { languageCoverageSchema } from './analysis-schema'
import {
  architectureEdgeSchema,
  architectureGraphSchema,
  architectureNodeSchema,
  sourceSchema,
  relativeSourceSchema
} from './schema'

export const ARCHITECTURE_CONTEXT_CHAR_LIMIT = 24000
export const ARCHITECTURE_CONTEXT_BYTE_LIMIT = 48000
const count = z.number().int().min(0).max(1200)
const envelope = z.object({
  available: z.literal(true),
  workspaceId: z.string().regex(/^[a-f0-9]{32}$/),
  snapshotId: z.string().uuid(),
  staleness: z.enum(['fresh', 'stale', 'unknown']),
  source: z.literal('Pi-Harness source-verified index'),
  coverage: architectureGraphSchema.shape.coverage,
  analysis: z
    .object({
      languages: z.array(languageCoverageSchema).max(32),
      diagnosticCount: z.number().int().nonnegative(),
      diagnosticsTruncated: z.boolean()
    })
    .strict()
    .optional(),
  warning: z.string().max(1000)
})
const page = { total: count, nextOffset: count.nullable() }
const moduleList = z
  .array(
    architectureNodeSchema.extend({
      description: z.string().max(240),
      sourceReferences: z.array(sourceSchema).length(1)
    })
  )
  .max(30)
const modulePage = envelope
  .extend({ pagination: z.literal('modules'), modules: moduleList, ...page })
  .strict()
export const architectureContextResultSchema = z
  .union([
    z.object({ available: z.literal(false), warning: z.string().max(1000) }).strict(),
    z.discriminatedUnion('tool', [
      envelope
        .extend({
          tool: z.literal('get_project_architecture'),
          summary: z.string().max(3000),
          project: architectureGraphSchema.shape.project
            .omit({ packages: true })
            .extend({
              packages: z
                .array(
                  z
                    .object({
                      name: z.string().max(200),
                      manifest: relativeSourceSchema,
                      entrypointCount: count
                    })
                    .strict()
                )
                .max(5),
              packageCount: z.number().int().min(0).max(100)
            })
            .strict(),
          entrypoints: z.array(relativeSourceSchema).max(10),
          entrypointCount: count,
          revision: architectureGraphSchema.shape.revision.pick({
            createdAt: true,
            commit: true,
            branch: true,
            analyzerVersion: true,
            modelId: true
          }),
          nodeCount: count,
          edgeCount: count
        })
        .strict(),
      modulePage.extend({ tool: z.literal('search_project_modules') }).strict(),
      envelope
        .extend({
          tool: z.literal('get_module_details'),
          pagination: z.literal('relationships'),
          module: architectureNodeSchema.extend({
            sourceReferences: z.array(sourceSchema).min(1).max(3)
          }),
          sourceReferenceCount: count,
          relationships: z.array(architectureEdgeSchema).max(30),
          ...page
        })
        .strict(),
      envelope
        .extend({
          tool: z.literal('get_module_sources'),
          pagination: z.literal('sourceReferences'),
          references: z.array(sourceSchema).max(30),
          ...page
        })
        .strict(),
      modulePage
        .extend({
          tool: z.literal('get_related_modules'),
          relationships: z.array(architectureEdgeSchema).max(30),
          relationshipCount: count,
          relationshipsTruncated: z.boolean()
        })
        .strict()
    ])
  ])
  .refine((result) => {
    const serialized = JSON.stringify(result)
    return (
      serialized.length <= ARCHITECTURE_CONTEXT_CHAR_LIMIT &&
      new TextEncoder().encode(serialized).byteLength <= ARCHITECTURE_CONTEXT_BYTE_LIMIT
    )
  }, 'Architecture context exceeds retrieval budget')

export type ArchitectureContextResult = z.infer<typeof architectureContextResultSchema>
