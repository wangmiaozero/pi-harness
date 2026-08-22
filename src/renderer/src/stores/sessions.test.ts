import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from './sessions'

describe('session store transient sessions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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
})
