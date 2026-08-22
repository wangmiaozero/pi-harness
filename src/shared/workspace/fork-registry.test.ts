import { describe, expect, it } from 'vitest'

/**
 * Registry fork contract: AgentSession.fork() mutates the wrapper in-place, so
 * the old sessionId must be destroyed immediately. The next request reloads a
 * clean AgentSession from the original JSONL.
 */
class FakeRegistry {
  private map = new Map<string, { sessionId: string; destroyed: boolean }>()

  set(id: string, wrapper: { sessionId: string; destroyed: boolean }): void {
    this.map.set(id, wrapper)
  }

  get(id: string): { sessionId: string; destroyed: boolean } | undefined {
    return this.map.get(id)
  }

  destroy(id: string): void {
    const wrapper = this.map.get(id)
    if (wrapper) wrapper.destroyed = true
    this.map.delete(id)
  }

  fork(oldId: string, newId: string): string {
    const wrapper = this.map.get(oldId)
    if (!wrapper) throw new Error('missing')
    wrapper.sessionId = newId
    this.destroy(oldId)
    return newId
  }
}

describe('fork wrapper destroy', () => {
  it('releases the old id so a later resume cannot see the forked inner session', () => {
    const registry = new FakeRegistry()
    registry.set('old', { sessionId: 'old', destroyed: false })
    const newId = registry.fork('old', 'new')
    expect(newId).toBe('new')
    expect(registry.get('old')).toBeUndefined()
    expect(registry.get('new')).toBeUndefined()
  })
})
