import { describe, expect, it } from 'vitest'
import { agentModeDirective, normalizeAgentMode, toolPresetForAgentMode } from './agent-mode'
import { TOOL_PRESET_VALUES } from './tool-presets'

describe('agent mode', () => {
  it.each(TOOL_PRESET_VALUES)(
    'enforces planning restrictions for %s without enabling tools from off',
    (preset) => {
      expect(toolPresetForAgentMode('plan', preset)).toBe(preset === 'none' ? 'none' : 'read-only')
      expect(toolPresetForAgentMode('agent', preset)).toBe(preset)
      expect(toolPresetForAgentMode('goal', preset)).toBe(preset)
    }
  )
  it('normalizes unknown values to agent', () => {
    expect(normalizeAgentMode('plan')).toBe('plan')
    expect(normalizeAgentMode('goal')).toBe('goal')
    expect(normalizeAgentMode('agent')).toBe('agent')
    expect(normalizeAgentMode('auto')).toBe('agent')
    expect(normalizeAgentMode(undefined)).toBe('agent')
  })

  it('gives plan mode a read-only planning directive', () => {
    const directive = agentModeDirective('plan')
    expect(directive).toContain('[Mode: plan]')
    expect(directive).toContain('Do not modify')
    expect(agentModeDirective('goal')).toContain('[Mode: goal]')
    expect(agentModeDirective('agent')).toBeNull()
  })
})
