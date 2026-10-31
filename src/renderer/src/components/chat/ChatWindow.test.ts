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
import type { ToolPreset } from '@shared/workspace/tool-presets'

afterEach(() => {
  delete window.piSwitch
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([
  ['planning', 'full', 'read-only', false],
  ['planning', 'none', 'none', false],
  [null, 'none', 'none', false],
  [null, 'read-only', 'read-only', false],
  ['planning', 'full', 'read-only', true],
  ['planning', 'none', 'none', true]
] as const)(
  'uses the displayed planning tools for session %s (%s → %s, queued images: %s)',
  async (sessionId, selected: ToolPreset, effective, queued) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    window.piSwitch = { on: vi.fn(() => () => undefined) } as unknown as PiSwitchAPI
    setActivePinia(createPinia())
    const agent = useAgentStore()
    const sessions = useSessionStore()
    const workspace = useWorkspaceStore()
    if (sessionId) sessions.addTransientSession(sessionId, '/project', 'Plan')
    sessions.selectSession(sessionId)
    workspace.draft = 'Inspect this project'
    agent.toolPreset = selected
    const send = vi.spyOn(agent, 'send').mockResolvedValue(sessionId)
    const wrapper = shallowMount(ChatWindow, { global: { plugins: [i18n] } })
    try {
      const images = queued
        ? [{ type: 'image' as const, data: 'fixture', mimeType: 'image/png' }]
        : []
      const composer = wrapper.findComponent(ChatComposer)
      if (queued) composer.vm.$emit('sendQueue', images, 'plan')
      else composer.vm.$emit('send', null, 'plan')
      await flushPromises()
      expect(send).toHaveBeenCalledWith(
        sessionId,
        null,
        expect.stringContaining('[Mode: plan]'),
        effective,
        images,
        queued ? '' : 'Inspect this project',
        'auto'
      )
    } finally {
      wrapper.unmount()
    }
  }
)

it.each([false, true])(
  'unlocks the composer after submission settles (failure: %s)',
  async (failure) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    window.piSwitch = { on: vi.fn(() => () => undefined) } as unknown as PiSwitchAPI
    setActivePinia(createPinia())
    const agent = useAgentStore()
    const sessions = useSessionStore()
    const workspace = useWorkspaceStore()
    sessions.addTransientSession('current', '/project', 'Original')
    sessions.selectSession('current')
    workspace.draft = 'Original'
    let finish!: (value: string) => void
    const send = vi.spyOn(agent, 'send').mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        })
    )
    const wrapper = shallowMount(ChatWindow, { global: { plugins: [i18n] } })
    try {
      const composer = wrapper.findComponent(ChatComposer)
      composer.vm.$emit('send')
      composer.vm.$emit('send')
      await flushPromises()
      expect(composer.props('submitting')).toBe(true)
      expect(send).toHaveBeenCalledTimes(1)
      expect(workspace.draft).toBe('Original')
      if (failure) agent.error = 'Fixture send failed'
      finish('current')
      await flushPromises()
      expect(composer.props('submitting')).toBe(false)
      expect(workspace.draft).toBe(failure ? 'Original' : '')
    } finally {
      wrapper.unmount()
    }
  }
)

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
