import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Gauge } from '@lucide/vue'
import { CHAT_VIEW_ACTIVE } from '@renderer/composables/chat-view-activity'
import { i18n } from '@renderer/i18n'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import { useAgentStore } from '@renderer/stores/agent'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import ChatWindow from './ChatWindow.vue'
import ChatComposer from './ChatComposer.vue'
import MessageHistory from './MessageHistory.vue'
import type { ToolPreset } from '@shared/workspace/tool-presets'
import type { AgentStateSnapshot } from '@shared/types/workspace'

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
      const composer = wrapper.getComponent<typeof ChatComposer>(ChatComposer)
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
      const composer = wrapper.getComponent<typeof ChatComposer>(ChatComposer)
      composer.vm.$emit('send', null)
      composer.vm.$emit('send', null)
      await flushPromises()
      expect(composer.props('submitting')).toBe(true)
      expect(wrapper.findComponent(MessageHistory).props('running')).toBe(true)
      expect(send).toHaveBeenCalledTimes(1)
      expect(workspace.draft).toBe('Original')
      if (failure) agent.error = 'Fixture send failed'
      finish('current')
      await flushPromises()
      expect(composer.props('submitting')).toBe(false)
      expect(wrapper.findComponent(MessageHistory).props('running')).toBe(false)
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
    wrapper.getComponent<typeof ChatComposer>(ChatComposer).vm.$emit('send', null)
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

it('suspends hidden transcript presentation and resumes from the current store without losing tokens', async () => {
  window.piSwitch = { on: vi.fn(() => () => undefined) } as unknown as PiSwitchAPI
  setActivePinia(createPinia())
  const agent = useAgentStore()
  const active = ref(true)
  agent.messages = [{ role: 'user', content: 'Original' }]
  const wrapper = shallowMount(ChatWindow, {
    global: { plugins: [i18n], provide: { [CHAT_VIEW_ACTIVE as symbol]: active } }
  })
  await flushPromises()
  const history = () => wrapper.findComponent(MessageHistory)
  const original = history().props('items')
  active.value = false
  await flushPromises()
  agent.messages = [...agent.messages, { role: 'user', content: 'Background persisted message' }]
  agent.streaming = {
    ...agent.streaming,
    isStreaming: true,
    streamingMessage: {
      role: 'assistant',
      model: 'fixture',
      provider: 'fixture',
      content: [{ type: 'text', text: 'Complete background stream' }]
    }
  }
  await flushPromises()
  expect(history().props('items')).toBe(original)
  expect(history().props('liveMessage')).toBeNull()
  expect(agent.messages).toHaveLength(2)
  active.value = true
  await flushPromises()
  expect(history().props('items')).toHaveLength(2)
  expect(history().props('liveMessage')).toMatchObject({
    content: [{ text: 'Complete background stream' }]
  })
  wrapper.unmount()
})

it('colors only the composer context icon when usage exceeds 80%', async () => {
  window.piSwitch = { on: vi.fn(() => () => undefined) } as unknown as PiSwitchAPI
  setActivePinia(createPinia())
  const agent = useAgentStore()
  const state: AgentStateSnapshot = {
    sessionId: 'context-fixture',
    sessionFile: '',
    status: 'idle',
    isStreaming: false,
    isPromptRunning: false,
    isBashRunning: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    thinkingLevel: 'off',
    contextUsage: null,
    pendingMessageCount: 0,
    queuedMessages: { steering: [], followUp: [] }
  }
  const wrapper = shallowMount(ChatWindow, {
    global: {
      plugins: [i18n],
      stubs: { ChatComposer: { template: '<div><slot name="session-actions" /></div>' } }
    }
  })
  try {
    for (const percent of [null, 70, 80, 80.5]) {
      agent.state = {
        ...state,
        contextUsage: {
          percent,
          tokens: percent === null ? null : percent * 100,
          contextWindow: 10000
        }
      }
      await wrapper.vm.$nextTick()
      const usage = wrapper.get('[data-testid="composer-context-usage"]')
      expect(usage.text()).toBe(
        percent === null ? '?' : `${percent.toLocaleString(i18n.global.locale.value)}%`
      )
      expect(usage.getComponent(Gauge).classes().includes('text-[var(--danger)]')).toBe(
        percent !== null && percent > 80
      )
      expect(usage.classes()).not.toContain('text-[var(--danger)]')
    }
  } finally {
    wrapper.unmount()
  }
})
