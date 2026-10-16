import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { i18n } from '@renderer/i18n'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import { useAgentStore } from '@renderer/stores/agent'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import ChatWindow from './ChatWindow.vue'
import ChatComposer from './ChatComposer.vue'

afterEach(() => {
  delete window.piSwitch
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('persists the first sent session before asynchronous workspace restoration finishes', async () => {
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value)
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  window.piSwitch = {
    on: vi.fn(() => () => undefined),
    workspace: {
      getDefaultRoots: async () => [],
      getDefaultRoot: async () => '/managed',
      listSessionBindings: async () => ({}),
      sync: async () => ({ folders: [], name: '' })
    }
  } as unknown as PiSwitchAPI
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  setActivePinia(createPinia())
  const agent = useAgentStore()
  const sessions = useSessionStore()
  const workspace = useWorkspaceStore()
  await workspace.restore({ restoreTabs: true, autoOpenLastProject: true })
  workspace.draft = 'First message'
  vi.spyOn(agent, 'send').mockImplementation(async () => {
    sessions.addTransientSession('first-session', '/project', 'First message')
    return 'first-session'
  })
  const wrapper = shallowMount(ChatWindow, { global: { plugins: [i18n] } })
  try {
    wrapper.findComponent(ChatComposer).vm.$emit('send')
    await flushPromises()
    expect(sessions.currentId).toBe('first-session')
    const snapshot = [...saved.values()]
      .map((value) => {
        try {
          return JSON.parse(value)
        } catch {
          return null
        }
      })
      .find((value) => value?.activeTabId === 'chat:first-session')
    expect(snapshot?.tabs).toContainEqual(expect.objectContaining({ sessionId: 'first-session' }))
  } finally {
    wrapper.unmount()
  }
})
