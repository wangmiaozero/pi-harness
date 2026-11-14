export function buildKiloCatalog(rows: unknown[]): CatalogEntry[]

export interface CatalogEntry {
  id: string
  name: string
  vision: boolean
  reasoning: boolean
  tools: boolean
  contextWindow: number
  maxOutput: number
  canDisableThinking: boolean
  efforts?: string[]
  effortDefault?: string
  effortPatch?: Record<string, unknown>
  effortOffPatch?: Record<string, unknown>
}
