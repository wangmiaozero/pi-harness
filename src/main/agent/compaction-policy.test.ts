import { describe, expect, it, vi } from 'vitest'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { installCompactionPolicy } from '../../../resources/desktop-extension/compaction.mjs'

function fixture(model: Record<string, unknown>) {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  let level = 'max'
  const pi = {
    on: (name: string, handler: (...args: unknown[]) => void) => handlers.set(name, handler),
    getThinkingLevel: () => level,
    setThinkingLevel: vi.fn((next: string) => {
      level = next
    })
  }
  installCompactionPolicy(pi as unknown as ExtensionAPI)
  return { pi, emit: (event: string) => handlers.get(event)?.({}, { model }) }
}

describe('native automatic compaction policy', () => {
  it.each(['session_compact', 'session_compact_failed', 'session_shutdown'])(
    'restores the conversational level after %s',
    (event) => {
      const { pi, emit } = fixture({ reasoning: true })
      emit('session_before_compact')
      expect(pi.getThinkingLevel()).toBe('low')
      emit(event)
      expect(pi.getThinkingLevel()).toBe('max')
    }
  )
  it('only turns reasoning off when the model explicitly supports it', () => {
    const { pi, emit } = fixture({ reasoning: true, thinkingLevelMap: { off: 'none' } })
    emit('session_before_compact')
    expect(pi.getThinkingLevel()).toBe('off')
    pi.setThinkingLevel('medium')
    emit('session_compact')
    expect(pi.getThinkingLevel()).toBe('medium')
    emit('session_shutdown')
    expect(pi.getThinkingLevel()).toBe('medium')
  })
})
