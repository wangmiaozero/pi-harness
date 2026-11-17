import type { ToolEntry } from '../../src/shared/workspace/tool-presets'

export interface ToolSelectionOptions {
  preserveExtensionTools?: boolean
  custom?: boolean
  restore?: boolean
  initial?: boolean
  suspension?: string[] | null
}

interface PiToolRegistry {
  getAllTools(): Array<{
    name: string
    description: string
    exposure?: string
    sourceInfo?: { path: string; source?: string }
  }>
  getActiveTools(): string[]
  setActiveTools(names: string[]): void
}

export class ToolSelectionError extends Error {}

export function listTools(pi: Omit<PiToolRegistry, 'setActiveTools'>): ToolEntry[]
export function createToolSelection(pi: PiToolRegistry): {
  apply(names: string[], options?: ToolSelectionOptions): void
  refresh(): void
  suspension(): string[] | null
  allows(name: string): boolean
}
export type ToolSelection = ReturnType<typeof createToolSelection>
