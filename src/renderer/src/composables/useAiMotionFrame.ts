export interface AiMotionFrameState {
  sending: boolean
  runningAgentCount: number
  streaming: boolean
  promptRunning: boolean
}

export function shouldActivateAiMotionFrame(state: AiMotionFrameState): boolean {
  return state.sending || state.runningAgentCount > 0 || state.streaming || state.promptRunning
}
