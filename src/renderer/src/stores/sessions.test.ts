import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from './sessions'
import type { PiSwitchAPI } from '@shared/ipc/api-types'

describe('session store transient sessions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    delete window.piSwitch
  })

  it('keeps the newest of twenty refreshes when older requests finish last', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    window.piSwitch = {
      sessions: { list: vi.fn(() => new Promise((resolve) => resolvers.push(resolve))) }
    } as unknown as PiSwitchAPI
    const store = useSessionStore()
    const refreshes = Array.from({ length: 20 }, () => store.refresh(true))
    resolvers[19]([])
    await refreshes[19]
    store.selectSession('selected')
    for (let index = 18; index >= 0; index--) resolvers[index]([])
    await Promise.all(refreshes)
    expect(store.currentId).toBe('selected')
    expect(store.loading).toBe(false)
  })

  it('does not end a newer refresh or report an obsolete failure', async () => {
    let rejectOld!: (error: Error) => void
    let resolveNew!: (value: unknown[]) => void
    window.piSwitch = {
      sessions: {
        list: vi
          .fn()
          .mockImplementationOnce(
            () =>
              new Promise((_, reject) => {
                rejectOld = reject
              })
          )
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                resolveNew = resolve
              })
          )
      }
    } as unknown as PiSwitchAPI
    const store = useSessionStore()
    const old = store.refresh()
    const latest = store.refresh()
    rejectOld(new Error('obsolete'))
    await old
    expect(store.loading).toBe(true)
    expect(store.error).toBeNull()
    resolveNew([])
    await latest
    expect(store.loading).toBe(false)
  })

  it('places a new in-memory session under its project without duplicates', () => {
    const store = useSessionStore()

    store.addTransientSession('new-session', '/code/project', 'hello')
    store.addTransientSession('new-session', '/code/project', 'hello')
    store.selectSession('new-session')

    expect(store.items).toHaveLength(1)
    expect(store.items[0]).toMatchObject({
      id: 'new-session',
      projectRoot: '/code/project',
      transient: true
    })
    expect(store.currentProject?.sessions.map((session) => session.id)).toEqual(['new-session'])

    store.removeTransientSession('new-session')
    expect(store.items).toEqual([])
  })

  it('keeps persisted Skill sessions compact in navigation', async () => {
    window.piSwitch = {
      sessions: {
        list: vi.fn().mockResolvedValue([
          {
            path: '/sessions/skill.jsonl',
            id: 'skill-session',
            cwd: '/code/project',
            created: '2026-10-04T00:00:00.000Z',
            modified: '2026-10-04T00:00:01.000Z',
            messageCount: 1,
            firstMessage:
              '<skill name="demo-skill" location="/skills/demo-skill/SKILL.md">\n' +
              'References are relative to /skills/demo-skill.\n\n# Instructions\n</skill>\n\nReview this'
          }
        ])
      }
    } as unknown as PiSwitchAPI

    const store = useSessionStore()
    await store.refresh()

    expect(store.items[0]?.firstMessage).toBe('@demo-skill Review this')
  })
})
