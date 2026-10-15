import { z } from 'zod'
import type { ArchitectureContextResult } from './context-schema'
import { architectureAnalysisSchema } from './analysis-schema'

export const relativeSourceSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.includes('\\') &&
      !p.includes(':') &&
      !p.split('/').some((s) => s === '..' || s === '.' || !s),
    'Expected a project-relative source path'
  )
export const sourceSchema = z
  .object({
    path: relativeSourceSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()
  .refine((r) => r.endLine >= r.startLine)
export const evidenceSchema = z.enum(['static-verified', 'ai-inferred', 'unverified'])
export const architectureNodeSchema = z
  .object({
    id: z.string().regex(/^n-[a-f0-9]{16}$/),
    name: z.string().max(500),
    type: z.string().max(50),
    description: z.string().max(1600),
    packageManifest: relativeSourceSchema.optional(),
    evidence: evidenceSchema,
    sourceReferences: z.array(sourceSchema).min(1).max(20)
  })
  .strict()
export const architectureEdgeSchema = z
  .object({
    id: z.string().max(100),
    source: z.string().regex(/^n-[a-f0-9]{16}$/),
    target: z.string().regex(/^n-[a-f0-9]{16}$/),
    relation: z.string().max(80),
    evidence: evidenceSchema,
    sourceReferences: z.array(sourceSchema).min(1).max(10)
  })
  .strict()
export const architectureGraphSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: z.string().regex(/^[a-f0-9]{32}$/),
    snapshotId: z.string().uuid(),
    project: z
      .object({
        name: z.string().max(255),
        languages: z.array(z.string().max(80)).max(32),
        frameworks: z.array(z.string().max(80)).max(32),
        packageManagers: z.array(z.string().max(80)).max(32),
        packages: z
          .array(
            z
              .object({
                name: z.string().max(200),
                manifest: relativeSourceSchema,
                entrypoints: z.array(relativeSourceSchema).max(20)
              })
              .strict()
          )
          .max(100)
          .default([])
      })
      .strict(),
    revision: z
      .object({
        createdAt: z.string().datetime(),
        commit: z.string().optional(),
        branch: z.string().optional(),
        fingerprint: z.string(),
        excludes: z.array(relativeSourceSchema).max(30).default([]),
        analyzerVersion: z.union([z.literal(1), z.literal(2)]),
        archifyVersion: z.string().max(80).nullable(),
        rendererProvider: z.string().max(80).default('archify'),
        rendererVersion: z.string().max(80).nullable().default(null),
        modelId: z.string().nullable(),
        durationMs: z.number().nonnegative()
      })
      .strict(),
    nodes: z.array(architectureNodeSchema).max(400),
    edges: z.array(architectureEdgeSchema).max(1200),
    entrypoints: z.array(relativeSourceSchema).max(50),
    summary: z.string().max(3000),
    analysis: architectureAnalysisSchema.optional(),
    warnings: z.array(z.string().max(1000)).max(30),
    coverage: z
      .object({
        files: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        bytes: z.number().int().nonnegative(),
        partial: z.boolean()
      })
      .strict()
  })
  .strict()
  .superRefine((g, ctx) => {
    const ids = new Set(g.nodes.map((n) => n.id))
    if (
      ids.size !== g.nodes.length ||
      g.edges.some((e) => !ids.has(e.source) || !ids.has(e.target))
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid graph identities or endpoints' })
  })
export type ArchitectureGraph = z.infer<typeof architectureGraphSchema>
export type SourceReference = z.infer<typeof sourceSchema>
export type ArchitectureNode = z.infer<typeof architectureNodeSchema>
export const intelligenceRequestSchema = z
  .object({ root: z.string().min(1).max(4096), snapshotId: z.string().uuid().optional() })
  .strict()
export const analysisRequestSchema = intelligenceRequestSchema.extend({
  ai: z.boolean().default(false),
  locale: z
    .enum(['en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'ru-RU', 'fr-FR', 'de-DE'])
    .default('en'),
  excludes: z.array(relativeSourceSchema).max(30).default([])
})
export type ArchitectureLocale = z.infer<typeof analysisRequestSchema>['locale']
export const architectureMapRequestSchema = intelligenceRequestSchema.extend({
  snapshotId: z.string().uuid(),
  offset: z.number().int().min(0).max(399).default(0),
  moduleId: z
    .string()
    .regex(/^n-[a-f0-9]{16}$/)
    .optional(),
  locale: analysisRequestSchema.shape.locale
})
export type ArchitectureMap = {
  viewerUrl: string
  moduleIds: string[]
  offset: number
  focus: string | null
}
export const moduleQuerySchema = z
  .object({
    workspaceId: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
    query: z.string().max(200).optional(),
    moduleId: z.string().max(100).optional(),
    direction: z.enum(['upstream', 'downstream', 'both']).default('both'),
    offset: z.number().int().min(0).max(1200).default(0),
    limit: z.number().int().min(1).max(30).default(15)
  })
  .strict()
export type ModuleQuery = z.infer<typeof moduleQuerySchema>
export const analysisPhaseSchema = z.enum([
  'idle',
  'preparing',
  'scanning',
  'extracting',
  'analyzing',
  'validating',
  'rendering',
  'indexing',
  'completed',
  'failed',
  'cancelled'
])
export type AnalysisState = {
  phase: z.infer<typeof analysisPhaseSchema>
  files: number
  waiting?: boolean
  error?: string
}
export type ArchitectureSnapshot = {
  graph: ArchitectureGraph
  staleness: 'fresh' | 'stale' | 'unknown'
  viewerUrl: string | null
}
export const architectureControlActionSchema = z.enum([
  'previous',
  'next',
  'overview',
  'fullscreen'
])
export const architectureViewerControlsSchema = z
  .object({
    range: z.string().max(100),
    focused: z.boolean(),
    previousDisabled: z.boolean(),
    nextDisabled: z.boolean(),
    busy: z.boolean(),
    fullscreen: z.boolean(),
    labels: z
      .object({
        previous: z.string().min(1).max(150),
        next: z.string().min(1).max(150),
        overview: z.string().min(1).max(150),
        fullscreen: z.string().min(1).max(150),
        exitFullscreen: z.string().min(1).max(150)
      })
      .strict()
  })
  .strict()
export type ArchitectureViewerControls = z.infer<typeof architectureViewerControlsSchema>
const canvasColorSchema = z.string().regex(/^#[a-fA-F0-9]{6}$/)
export const architectureCanvasPaletteSchema = z
  .object({
    background: canvasColorSchema,
    surface: canvasColorSchema,
    foreground: canvasColorSchema,
    muted: canvasColorSchema,
    accent: canvasColorSchema
  })
  .strict()
export type ArchitectureCanvasPalette = z.infer<typeof architectureCanvasPaletteSchema>
export interface ProjectIntelligenceAPI {
  map(input: z.input<typeof architectureMapRequestSchema>): Promise<ArchitectureMap>
  viewer(input: {
    url: string | null
    bounds: { x: number; y: number; width: number; height: number }
    theme: 'dark' | 'light'
    selectedId?: string
    controls?: ArchitectureViewerControls
    palette?: ArchitectureCanvasPalette
  }): Promise<void>
  analyze(input: z.input<typeof analysisRequestSchema>): Promise<AnalysisState>
  status(root: string): Promise<AnalysisState>
  cancel(root: string): Promise<void>
  history(root: string): Promise<Array<{ snapshotId: string; createdAt: string; summary: string }>>
  snapshot(input: z.infer<typeof intelligenceRequestSchema>): Promise<ArchitectureSnapshot | null>
  query(root: string, query: z.input<typeof moduleQuerySchema>): Promise<ArchitectureContextResult>
  source(
    root: string,
    snapshotId: string,
    moduleId: string,
    path: string
  ): Promise<{ path: string; line: number }>
  export(
    root: string,
    snapshotId: string,
    format: 'json' | 'html' | 'png',
    viewerUrl?: string
  ): Promise<boolean>
  clear(root: string): Promise<void>
}
