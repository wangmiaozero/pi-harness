import { describe, expect, it } from 'vitest'
import { agentModeDirective, normalizeAgentMode } from './agent-mode'

describe('agent mode', () => {
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
