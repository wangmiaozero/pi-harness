export interface ToolEntry {
  name: string
  description: string
  active: boolean
  available?: boolean
  source?: 'builtin' | 'extension' | 'mcp' | 'other'
}

export const FIXED_TOOL_PRESET_VALUES = ['none', 'read-only', 'default', 'full'] as const
export const TOOL_PRESET_VALUES = [...FIXED_TOOL_PRESET_VALUES, 'custom'] as const
export type FixedToolPreset = (typeof FIXED_TOOL_PRESET_VALUES)[number]
export type ToolPreset = (typeof TOOL_PRESET_VALUES)[number]
export const DEFAULT_TOOL_PRESET: FixedToolPreset = 'full'

export const PRESET_NONE: string[] = []
export const PRESET_READ_ONLY: string[] = ['read', 'grep', 'find', 'ls']
export const PRESET_DEFAULT: string[] = ['read', 'bash', 'edit', 'write']
export const PRESET_FULL: string[] = ['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls']

/** The read-only preset must not retain additional tools with unknown effects. */
export function isReadOnlyToolPreset(toolNames: readonly string[]): boolean {
  return (
    toolNames.length === PRESET_READ_ONLY.length &&
    PRESET_READ_ONLY.every((name) => toolNames.includes(name))
  )
}

export function isToolPreset(value: unknown): value is ToolPreset {
  return (TOOL_PRESET_VALUES as readonly unknown[]).includes(value)
}

export function getPresetFromTools(tools: ToolEntry[]): ToolPreset {
  const active = new Set(tools.filter((tool) => tool.active).map((tool) => tool.name))
  if (active.size === 0) return 'none'

  for (const preset of FIXED_TOOL_PRESET_VALUES) {
    const names = getToolNamesForPreset(preset)
    if (
      names.length === active.size &&
      names.every((name) => active.has(name) || (name === 'bash' && active.has('powershell')))
    )
      return preset
  }
  return 'custom'
}

const PRESET_TOOLS: Record<FixedToolPreset, readonly string[]> = {
  none: PRESET_NONE,
  'read-only': PRESET_READ_ONLY,
  default: PRESET_DEFAULT,
  full: PRESET_FULL
}

export function getToolNamesForPreset(preset: FixedToolPreset): string[] {
  return [...PRESET_TOOLS[preset]]
}
