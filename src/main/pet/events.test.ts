import { describe, expect, it, vi } from 'vitest'
import { PetEventBridge } from './events'
import type { PetWindowController } from './pet-window'
import type { AgentEvent } from '@shared/types/workspace'

describe('task activity for manual interactions', () => {
  it('retains one subscription per source and reattaches after disposal', () => {
    const controller = { isVisible: () => true, pushState: vi.fn() }
    const bridge = new PetEventBridge(controller as unknown as PetWindowController, () => false)
    const detach = vi.fn()
    const onEvent = vi.fn(() => detach)
    const source = { onEvent, listRunning: () => [] }
    bridge.attach(source)
    bridge.attach(source)
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(detach).not.toHaveBeenCalled()

    const nextDetach = vi.fn()
    const next = { onEvent: vi.fn(() => nextDetach), listRunning: () => [] }
    bridge.attach(next)
    expect(detach).toHaveBeenCalledOnce()
    expect(next.onEvent).toHaveBeenCalledOnce()
    bridge.dispose()
    bridge.dispose()
    expect(nextDetach).toHaveBeenCalledOnce()
    bridge.attach(next)
    expect(next.onEvent).toHaveBeenCalledTimes(2)
    bridge.dispose()
  })

  it('pushes authoritative activity even when visual sync is disabled and events are unmapped', () => {
    const controller = { isVisible: () => true, pushState: vi.fn() }
    const bridge = new PetEventBridge(controller as unknown as PetWindowController, () => false)
    let listener!: (event: AgentEvent) => void
    let running = ['a', 'b']
    bridge.attach({
      onEvent: (callback) => {
        listener = callback
        return () => {}
      },
      listRunning: () => running
    })
    listener({ type: 'agent_start', sessionId: 'a' } as AgentEvent)
    expect(controller.pushState).toHaveBeenLastCalledWith([], 2)
    running = ['b']
    listener({ type: 'agent_end', sessionId: 'a' } as AgentEvent)
    expect(controller.pushState).toHaveBeenLastCalledWith([], 1)
    running = []
    listener({ type: 'agent_end', sessionId: 'b' } as AgentEvent)
    expect(controller.pushState).toHaveBeenLastCalledWith([], 0)
    bridge.dispose()
  })
})
