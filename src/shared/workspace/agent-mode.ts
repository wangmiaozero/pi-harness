import type { ToolPreset } from './tool-presets'

/** Work style directives complement the runtime's enforced tool selection. */
export const AGENT_MODES = ['agent', 'plan', 'goal'] as const
export type AgentMode = (typeof AGENT_MODES)[number]

export function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === 'string' && (AGENT_MODES as readonly string[]).includes(value)
}

export function normalizeAgentMode(value: unknown): AgentMode {
  return isAgentMode(value) ? value : 'agent'
}

/**
 * Directive prepended to the user's prompt so the model honors the selected
 * mode. Plan mode also restricts both new and existing sessions to read-only tools.
 */
export function agentModeDirective(mode: AgentMode): string | null {
  if (mode === 'plan') {
    return (
      '[Mode: plan] You are in planning mode. Inspect the workspace read-only, think the ' +
      'task through, and present a concrete step-by-step plan for approval. Do not modify, ' +
      'create, or delete any files.'
    )
  }
  if (mode === 'goal') {
    return (
      '[Mode: goal] Work autonomously toward the goal in the request below. Keep working ' +
      'until it is fully achieved; only stop to report when the goal is done or genuinely blocked.'
    )
  }
  return null
}

export function toolPresetForAgentMode(mode: AgentMode, preset: ToolPreset): ToolPreset {
  return mode === 'plan' && preset !== 'none' ? 'read-only' : preset
}
