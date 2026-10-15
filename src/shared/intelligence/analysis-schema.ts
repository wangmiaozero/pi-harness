import { z } from 'zod'

export const languageCoverageSchema = z
  .object({
    language: z.string().max(80),
    files: z.number().int().nonnegative(),
    imports: z.enum(['ast', 'static-declarations', 'file-index-only', 'unknown']),
    calls: z.literal('unknown'),
    resolved: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative()
  })
  .strict()
export const analysisDiagnosticSchema = z
  .object({
    code: z.string().max(100),
    path: z.string().max(500),
    line: z.number().int().positive(),
    specifier: z.string().max(500).optional()
  })
  .strict()
export const architectureAnalysisSchema = z
  .object({
    version: z.literal(1),
    scannerVersions: z.record(z.string(), z.string()),
    languages: z.array(languageCoverageSchema).max(32),
    diagnostics: z.array(analysisDiagnosticSchema).max(200),
    diagnosticsTruncated: z.boolean()
  })
  .strict()
export type ArchitectureAnalysis = z.infer<typeof architectureAnalysisSchema>
