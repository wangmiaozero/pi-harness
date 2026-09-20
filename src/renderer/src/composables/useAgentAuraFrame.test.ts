import { describe, expect, it } from 'vitest'
import {
  agentAuraKindForThinking,
  shouldActivateAgentAuraFrame,
  type AgentAuraFrameState
} from './useAgentAuraFrame'

const idle: AgentAuraFrameState = {
  sending: false,
  runningAgentCount: 0,
  streaming: false,
  promptRunning: false
}

describe('Agent Aura window frame', () => {
  it('stays inactive while the agent is idle', () => {
    expect(shouldActivateAgentAuraFrame(idle)).toBe(false)
  })

  it.each([
    { sending: true },
    { runningAgentCount: 1 },
    { streaming: true },
    { promptRunning: true }
  ])('activates only for agent execution state: %o', (change) => {
    expect(shouldActivateAgentAuraFrame({ ...idle, ...change })).toBe(true)
  })

  it('uses AGENT BURNING only for ultra thinking', () => {
    expect(agentAuraKindForThinking('ultra')).toBe('burning')
    expect(agentAuraKindForThinking('max')).toBe('glow')
    expect(agentAuraKindForThinking('high')).toBe('glow')
  })
})
