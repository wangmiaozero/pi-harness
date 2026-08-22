import { describe, expect, it } from 'vitest'
import { shouldActivateAiMotionFrame, type AiMotionFrameState } from './useAiMotionFrame'

const idle: AiMotionFrameState = {
  sending: false,
  runningAgentCount: 0,
  streaming: false,
  promptRunning: false
}

describe('AI motion window frame', () => {
  it('stays inactive while the agent is idle', () => {
    expect(shouldActivateAiMotionFrame(idle)).toBe(false)
  })

  it.each([
    { sending: true },
    { runningAgentCount: 1 },
    { streaming: true },
    { promptRunning: true }
  ])('activates only for agent execution state: %o', (change) => {
    expect(shouldActivateAiMotionFrame({ ...idle, ...change })).toBe(true)
  })
})
