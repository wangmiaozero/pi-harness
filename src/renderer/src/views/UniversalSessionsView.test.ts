import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import type { SessionHandoff, UniversalSession } from '@shared/universal/schema'
import { universalMessages } from '../i18n/universal'
import UniversalSessionsView from './UniversalSessionsView.vue'

const route = vi.hoisted(() => ({ query: {} as Record<string, string> }))
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn() })
}))

const Dialog = defineComponent({
  props: { open: Boolean },
  emits: ['update:open'],
  template:
    '<div v-if="open"><button data-testid="close-preview" @click="$emit(\'update:open\', false)">Close</button><slot /><slot name="footer" /></div>'
})
const session = (letter: string): UniversalSession => ({
  id: letter.repeat(64),
  schemaVersion: 1,
  provider: 'claude',
  nativeSessionId: letter,
  title: `Task ${letter}`,
  projectPath: `/project/${letter}`,
  workspacePath: `/project/${letter}`,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  messageCount: 1,
  source: {
    path: `/source/${letter}.jsonl`,
    root: '/source',
    format: 'jsonl',
    fingerprint: 'f'.repeat(64),
    status: 'available',
    syncedAt: '2026-10-01T00:00:00.000Z'
  },
  metadata: { hasToolCalls: false },
  warnings: [],
  blob: 'c'.repeat(64)
})

afterEach(() => {
  delete window.piSwitch
  route.query = {}
})

describe('history handoff interaction boundaries', () => {
  it('waits for rebuilding a cleared index before resolving a continuation source link', async () => {
    const item = session('a')
    route.query = { source: item.id }
    let synced = false
    let finish!: () => void
    const scan = new Promise<void>((resolve) => {
      finish = resolve
    })
    const idle = { running: false, cancelled: false, scanned: 0, changed: 0, errors: [] }
    window.piSwitch = {
      sessions: { list: async () => [] },
      universal: {
        list: async () => ({ sessions: synced ? [item] : [], total: synced ? 1 : 0, projects: [] }),
        sources: async () => [],
        status: async () => (synced ? { ...idle, lastSync: '2026-10-10' } : idle),
        sync: async () => {
          await scan
          synced = true
          return { ...idle, lastSync: '2026-10-10' }
        },
        read: async () => {
          if (!synced) throw new Error('History session not found.')
          return {
            session: item,
            total: 1,
            messages: [
              {
                id: 'm',
                sessionId: item.id,
                role: 'user',
                parts: [{ type: 'text', text: 'Recovered source history' }],
                sourceRef: '/source#record=1'
              }
            ]
          }
        }
      }
    } as unknown as PiSwitchAPI
    const wrapper = mount(UniversalSessionsView, {
      global: {
        plugins: [
          createPinia(),
          createI18n({
            legacy: false,
            locale: 'en-US',
            messages: { 'en-US': { universal: universalMessages['en-US'] } }
          })
        ],
        stubs: { Dialog }
      }
    })
    try {
      await flushPromises()
      finish()
      await flushPromises()
      expect(wrapper.get('[data-testid="history-messages"]').text()).toContain(
        'Recovered source history'
      )
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })
  it('discards a late preview after closing the dialog and selecting another conversation', async () => {
    const items = [session('a'), session('b')]
    let resolvePreview!: (value: SessionHandoff) => void
    const preview = vi.fn(
      () =>
        new Promise<SessionHandoff>((resolve) => {
          resolvePreview = resolve
        })
    )
    const continueTask = vi.fn()
    window.piSwitch = {
      sessions: { list: async () => [] },
      universal: {
        list: async () => ({ sessions: items, projects: [], total: 2 }),
        sources: async () => [],
        status: async () => ({
          running: false,
          cancelled: false,
          scanned: 0,
          changed: 0,
          errors: [],
          lastSync: '2026-10-01'
        }),
        read: async ({ id }: { id: string }) => ({
          session: items.find((s) => s.id === id),
          messages: [],
          total: 1
        }),
        map: async (id: string) => items.find((s) => s.id === id),
        preview,
        continue: continueTask
      }
    } as unknown as PiSwitchAPI
    const wrapper = mount(UniversalSessionsView, {
      global: {
        plugins: [
          createPinia(),
          createI18n({
            legacy: false,
            locale: 'en-US',
            messages: {
              'en-US': {
                universal: universalMessages['en-US'],
                common: { cancel: 'Cancel', loading: 'Loading' }
              }
            }
          })
        ],
        stubs: { Dialog }
      }
    })
    const clickText = async (text: string) => {
      await wrapper
        .findAll('button')
        .find((b) => b.text() === text)!
        .trigger('click')
      await flushPromises()
    }
    try {
      await flushPromises()
      await clickText('View history')
      await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
      await wrapper.get('textarea').setValue('Continue task a')
      await clickText('Prepare handoff')
      expect(preview).toHaveBeenCalledWith(items[0]!.id, 'Continue task a')
      await wrapper.get('[data-testid="close-preview"]').trigger('click')
      await wrapper
        .findAll('button')
        .filter((b) => b.text() === 'View history')[1]!
        .trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
      resolvePreview({
        instruction: 'Continue task a',
        goal: { text: 'Wrong old task' }
      } as SessionHandoff)
      await flushPromises()
      expect(wrapper.text()).not.toContain('Wrong old task')
      expect(wrapper.get('textarea').element.value).toBe('')
      expect(wrapper.get('[data-testid="handoff-confirm"]').attributes('disabled')).toBeDefined()
      expect(continueTask).not.toHaveBeenCalled()
    } finally {
      wrapper.unmount()
    }
  })
})
