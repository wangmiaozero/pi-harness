export interface AgentAuraFrameState {
  sending: boolean
  runningAgentCount: number
  streaming: boolean
  promptRunning: boolean
}

export type AgentAuraKind = 'glow' | 'burning'

export function shouldActivateAgentAuraFrame(state: AgentAuraFrameState): boolean {
  return state.sending || state.runningAgentCount > 0 || state.streaming || state.promptRunning
}

export function agentAuraKindForThinking(level: string): AgentAuraKind {
  return level === 'ultra' ? 'burning' : 'glow'
}
