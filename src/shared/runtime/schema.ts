import { z } from 'zod'

export const runtimeKindSchema = z.enum(['pi', 'node'])
export const runtimeSelectionSchema = z
  .object({
    source: z.enum(['bundled', 'system', 'custom']),
    customPath: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .refine((p) => !/[\0\r\n]/.test(p))
      .optional()
  })
  .strict()
  .refine((s) => s.source !== 'custom' || Boolean(s.customPath), 'Choose an executable')
export const runtimeSwitchSchema = z
  .object({ kind: runtimeKindSchema, selection: runtimeSelectionSchema })
  .strict()
export const runtimeMaintenanceSchema = z.object({ kind: runtimeKindSchema }).strict()

export type RuntimeKind = z.infer<typeof runtimeKindSchema>
export type RuntimeSelection = z.infer<typeof runtimeSelectionSchema>
export type RuntimeSource = RuntimeSelection['source']
export interface RuntimeConfiguration {
  pi: RuntimeSelection
  node: RuntimeSelection
}
export interface ResolvedRuntime {
  source: RuntimeSource
  executablePath: string | null
  version: string | null
  platform: string
  arch: string
  valid: boolean
  integrity: 'verified' | 'unmanaged' | 'failed'
  diagnosticMessages: string[]
  discoverySource?: string
  npm?: { cliPath: string; version: string }
  npx?: { cliPath: string; version: string }
}
export interface McpRuntimeCompatibility {
  id: string
  type: 'native' | 'node' | 'npm' | 'npx' | 'python' | 'docker' | 'remote'
  status: 'available' | 'unavailable' | 'external'
}
export interface RuntimeDiagnostics {
  mcp: McpRuntimeCompatibility[]
  compatibilityMode: boolean
  configuration: RuntimeConfiguration
  pi: ResolvedRuntime
  node: ResolvedRuntime
  activeSessions: number
  restartRequired: boolean
  previous: Partial<Record<RuntimeKind, boolean>>
}
export const DEFAULT_RUNTIME_CONFIGURATION: RuntimeConfiguration = {
  pi: { source: 'bundled' },
  node: { source: 'bundled' }
}
