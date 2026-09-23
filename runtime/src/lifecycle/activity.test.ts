import { describe, expect, it } from 'vitest'
import { describeActivity } from './activity.js'

describe('describeActivity', () => {
  it('stays idle when nothing is running', () => {
    const snapshot = describeActivity({ runningAgents: [], installState: null })
    expect(snapshot.busy).toBe(false)
    expect(snapshot.reasons).toEqual([])
    expect(snapshot.memory.rss).toBeGreaterThan(0)
  })

  it('blocks idle shutdown while an agent or install is active', () => {
    expect(
      describeActivity({ runningAgents: ['s1'], installState: null }).reasons
    ).toEqual(['agent'])
    expect(
      describeActivity({ runningAgents: [], installState: 'running' }).busy
    ).toBe(true)
    expect(
      describeActivity({ runningAgents: [], installState: 'success' }).busy
    ).toBe(false)
  })
})