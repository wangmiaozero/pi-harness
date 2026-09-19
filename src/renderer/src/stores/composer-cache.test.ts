import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetComposerCache,
  hydrateComposerSelections,
  readComposerCache,
  rememberComposerCache
} from './composer-cache'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    }
  }
}

describe('composer cache', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })

  it('remembers the last thinking level and tool preset across reloads', () => {
    rememberComposerCache('session-1', { thinkingLevel: 'ultra', toolPreset: 'full' })

    const restored = readComposerCache()
    expect(restored).toMatchObject({ thinkingLevel: 'ultra', toolPreset: 'full' })
    expect(restored.bySession['session-1']).toEqual({ thinkingLevel: 'ultra', toolPreset: 'full' })

    const map = new Map()
    const last = hydrateComposerSelections(map)
    expect(last).toEqual({ thinkingLevel: 'ultra', toolPreset: 'full' })
    expect(map.get('session-1')).toEqual({ thinkingLevel: 'ultra', toolPreset: 'full' })
  })

  it('falls unknown thinking values back to medium without migrating max to ultra', () => {
    rememberComposerCache('session-1', { thinkingLevel: 'godmode', toolPreset: 'default' })
    expect(readComposerCache().thinkingLevel).toBe('medium')
    rememberComposerCache('session-2', { thinkingLevel: 'max', toolPreset: 'default' })
    expect(readComposerCache().thinkingLevel).toBe('max')
  })

  it('drops a forgotten session without losing the last global prefs', () => {
    rememberComposerCache('session-1', { thinkingLevel: 'max', toolPreset: 'full' })
    forgetComposerCache('session-1')
    const restored = readComposerCache()
    expect(restored.thinkingLevel).toBe('max')
    expect(restored.toolPreset).toBe('full')
    expect(restored.bySession).toEqual({})
  })
})
