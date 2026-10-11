import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, isProxy } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import type {
  SessionHandoff,
  UniversalProjectResolution,
  UniversalSession
} from '@shared/universal/schema'
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
const localHandoff = (item: UniversalSession): SessionHandoff => ({
  id: 'c'.repeat(64),
  schemaVersion: 1,
  sourceSessionId: item.id,
  sourceProvider: 'claude',
  sourceFingerprint: item.source.fingerprint,
  workspacePath: item.projectPath!,
  createdAt: '2026-10-01T00:00:00.000Z',
  instruction: 'Continue task a',
  goal: { text: 'Fix login', evidence: [], confidence: 'high', verification: 'historical-claim' },
  completed: [],
  remaining: [],
  decisions: [],
  constraints: [],
  unresolvedIssues: [],
  relevantFiles: [],
  git: { status: '' },
  verification: { contextVerified: true, filesVerified: false, testsVerified: false },
  context: '[]',
  omittedMessages: 0
})

afterEach(() => {
  delete window.piSwitch
  route.query = {}
})

describe('history handoff interaction boundaries', () => {
  function setupProjectResolution(
    resolveProject: (id: string) => Promise<UniversalProjectResolution>,
    sourceStatus: UniversalSession['source']['status'] = 'available'
  ) {
    const items = [session('a'), session('b')].map(({ workspacePath: _path, ...item }) => {
      void _path
      return { ...item, source: { ...item.source, status: sourceStatus } }
    })
    const map = vi.fn(async (id: string, workspacePath: string, workspaceRoots: string[]) => ({
      ...items.find((s) => s.id === id)!,
      workspacePath,
      workspaceRoots: [...workspaceRoots]
    }))
    const preview = vi.fn(async (): Promise<SessionHandoff | null> => null)
    const organize = vi.fn(async (): Promise<SessionHandoff | null> => null)
    const scanStatus = {
      running: false,
      cancelled: false,
      scanned: 0,
      changed: 0,
      errors: [],
      lastSync: '2026-10-01'
    }
    const sync = vi.fn(async () => {
      items.forEach((item) => {
        item.source.status = 'available'
      })
      return scanStatus
    })
    const read = vi.fn(async ({ id }: { id: string }) => ({
      session: structuredClone(items.find((s) => s.id === id)),
      messages: [],
      total: 1
    }))
    window.piSwitch = {
      sessions: { list: async () => [] },
      universal: {
        list: async () => ({ sessions: structuredClone(items), projects: [], total: 2 }),
        sources: async () => [],
        status: async () => ({
          running: false,
          cancelled: false,
          scanned: 0,
          changed: 0,
          errors: [],
          lastSync: '2026-10-01'
        }),
        read,
        sync,
        resolveProject,
        map,
        preview,
        organize
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
              'en-US': { universal: universalMessages['en-US'], common: { loading: 'Loading' } }
            }
          })
        ],
        stubs: { Dialog }
      }
    })
    return { wrapper, items, map, preview, organize, sync, read }
  }
  it('uses an unimported recorded directory automatically without a separate save-link step', async () => {
    const resolveProject = vi.fn(async () => ({ status: 'available' as const, path: '/project/a' }))
    const { wrapper, items, map, preview } = setupProjectResolution(resolveProject)
    try {
      await flushPromises()
      await wrapper.get(`[data-testid="history-session-${items[0]!.id}"]`).trigger('click')
      await flushPromises()
      expect(resolveProject).not.toHaveBeenCalled()
      await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="handoff-project-path"]').text()).toBe('/project/a')
      expect(wrapper.text()).not.toContain('Save project link')
      expect(wrapper.find('[data-testid="handoff-project"] select').exists()).toBe(false)
      expect(map).not.toHaveBeenCalled()
      expect(wrapper.get('textarea').element.value).toBe(
        universalMessages['en-US'].defaultInstruction
      )
      expect(wrapper.get('textarea').element.value).toContain('Do not modify files, run tests')
      expect(preview).not.toHaveBeenCalled()
      await wrapper.get('textarea').setValue('Continue task a')
      await wrapper
        .findAll('button')
        .find((b) => b.text() === 'Prepare handoff')!
        .trigger('click')
      await flushPromises()
      expect(map).toHaveBeenCalledExactlyOnceWith(items[0]!.id, '/project/a', ['/project/a'])
      expect(preview).toHaveBeenCalledExactlyOnceWith(items[0]!.id, 'Continue task a')
      await wrapper
        .findAll('button')
        .find((b) => b.text() === 'Prepare handoff')!
        .trigger('click')
      await flushPromises()
      expect(map).toHaveBeenCalledTimes(2)
      expect(isProxy(map.mock.calls[1]![2])).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })
  it('shows a ready preview with a neutral test note and allows continuation', async () => {
    const { wrapper, items, preview } = setupProjectResolution(async () => ({
      status: 'available',
      path: '/project/a'
    }))
    preview.mockResolvedValue({
      id: 'c'.repeat(64),
      schemaVersion: 1,
      sourceSessionId: items[0]!.id,
      sourceProvider: 'claude',
      sourceFingerprint: 'f'.repeat(64),
      workspacePath: '/project/a',
      createdAt: '2026-10-01T00:00:00.000Z',
      instruction: 'Continue task a',
      goal: {
        text: 'Fix login',
        evidence: [],
        confidence: 'high',
        verification: 'historical-claim'
      },
      completed: [],
      remaining: [],
      decisions: [],
      constraints: [],
      unresolvedIssues: [],
      relevantFiles: [],
      git: { status: '' },
      verification: { contextVerified: true, filesVerified: false, testsVerified: false },
      context: '[]',
      omittedMessages: 0
    })
    try {
      await flushPromises()
      await wrapper.get(`[data-testid="history-session-${items[0]!.id}"]`).trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
      await flushPromises()
      await wrapper.get('textarea').setValue('Continue task a')
      await wrapper
        .findAll('button')
        .find((button) => button.text() === 'Prepare handoff')!
        .trigger('click')
      await flushPromises()
      const status = wrapper.get('[data-testid="handoff-status"]')
      expect(status.attributes('role')).toBe('status')
      expect(status.text()).toContain('Handoff preview ready')
      expect(status.text()).toContain('Project tests have not been rerun.')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="handoff-confirm"]').attributes('disabled')).toBeUndefined()
    } finally {
      wrapper.unmount()
    }
  })
  it('retries a failed scan and refreshes the selected detail so continuation is available immediately', async () => {
    const { wrapper, items, sync, read } = setupProjectResolution(
      async () => ({ status: 'available', path: '/project/a' }),
      'error'
    )
    try {
      await flushPromises()
      await wrapper.get(`[data-testid="history-session-${items[0]!.id}"]`).trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="history-source-status"]').text()).toContain('Scan failed')
      expect(wrapper.get('[data-testid="history-source-status"]').text()).not.toContain(
        'Source unavailable'
      )
      await wrapper.get('[data-testid="history-retry-scan"]').trigger('click')
      await flushPromises()
      expect(sync).toHaveBeenCalledOnce()
      expect(read).toHaveBeenCalledTimes(2)
      expect(wrapper.find('[data-testid="history-source-status"]').exists()).toBe(false)
      expect(
        wrapper.get('[data-testid="history-continue-task"]').attributes('disabled')
      ).toBeUndefined()
      await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="handoff-project-path"]').text()).toBe('/project/a')
    } finally {
      wrapper.unmount()
    }
  })
  it('retries before continuing a failed source without requiring another selection', async () => {
    const { wrapper, items, sync } = setupProjectResolution(
      async () => ({ status: 'available', path: '/project/a' }),
      'error'
    )
    try {
      await flushPromises()
      await wrapper.get(`[data-testid="history-session-${items[0]!.id}"]`).trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
      await flushPromises()
      expect(sync).toHaveBeenCalledOnce()
      expect(wrapper.get('[data-testid="handoff-project-path"]').text()).toBe('/project/a')
    } finally {
      wrapper.unmount()
    }
  })
  it('releases detail loading when a retry supersedes an earlier read and ignores its late result', async () => {
    const { wrapper, items, read } = setupProjectResolution(
      async () => ({ status: 'available', path: '/project/a' }),
      'error'
    )
    const stale = structuredClone(items[0]!)
    let release!: (value: Awaited<ReturnType<typeof read>>) => void
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    try {
      await flushPromises()
      await wrapper.get(`[data-testid="history-session-${items[0]!.id}"]`).trigger('click')
      await flushPromises()
      expect(
        wrapper.get('[data-testid="history-continue-task"]').attributes('disabled')
      ).toBeDefined()
      await wrapper.get('[data-testid="history-retry-scan"]').trigger('click')
      await flushPromises()
      expect(
        wrapper.get('[data-testid="history-continue-task"]').attributes('disabled')
      ).toBeUndefined()
      release({ session: stale, messages: [], total: 1 })
      await flushPromises()
      expect(wrapper.find('[data-testid="history-source-status"]').exists()).toBe(false)
      expect(
        wrapper.get('[data-testid="history-continue-task"]').attributes('disabled')
      ).toBeUndefined()
    } finally {
      wrapper.unmount()
    }
  })
  it('keeps a failed retry visible and distinguishes a genuinely missing original file', async () => {
    const { wrapper, items, sync } = setupProjectResolution(
      async () => ({ status: 'available', path: '/project/a' }),
      'missing'
    )
    sync.mockImplementation(async () => ({
      running: false,
      cancelled: false,
      scanned: 1,
      changed: 0,
      errors: [],
      lastSync: '2026-10-01'
    }))
    try {
      await flushPromises()
      await wrapper.get(`[data-testid="history-session-${items[0]!.id}"]`).trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="history-source-status"]').text()).toContain(
        'Source unavailable'
      )
      expect(
        wrapper.get('[data-testid="history-continue-task"]').attributes('disabled')
      ).toBeDefined()
      await wrapper.get('[data-testid="history-retry-scan"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="history-retry-scan"]').exists()).toBe(true)
      expect(
        wrapper.get('[data-testid="history-continue-task"]').attributes('disabled')
      ).toBeDefined()
    } finally {
      wrapper.unmount()
    }
  })
  it('calls AI only on the explicit button and preserves the local preview after a model failure', async () => {
    const { wrapper, items, preview, organize } = setupProjectResolution(async () => ({
      status: 'available',
      path: '/project/a'
    }))
    const local = localHandoff(items[0]!)
    preview.mockResolvedValue(local)
    organize.mockRejectedValueOnce(new Error('Model unavailable'))
    organize.mockResolvedValue({
      ...local,
      aiSummary: {
        text: 'AI historical summary',
        provider: 'configured-provider',
        modelId: 'configured-model',
        createdAt: '2026-10-11T00:00:00.000Z'
      }
    })
    try {
      await flushPromises()
      await wrapper.get(`[data-testid="history-session-${items[0]!.id}"]`).trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
      await flushPromises()
      await wrapper.get('textarea').setValue(local.instruction)
      await wrapper
        .findAll('button')
        .find((b) => b.text() === 'Prepare handoff')!
        .trigger('click')
      await flushPromises()
      expect(organize).not.toHaveBeenCalled()
      await wrapper.get('[data-testid="handoff-ai-organize"]').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Model unavailable')
      expect(wrapper.get('[data-testid="handoff-status"]').text()).toContain(
        'Handoff preview ready'
      )
      expect(wrapper.get('[data-testid="handoff-confirm"]').attributes('disabled')).toBeUndefined()
      await wrapper.get('[data-testid="handoff-ai-organize"]').trigger('click')
      await flushPromises()
      expect(organize).toHaveBeenCalledTimes(2)
      expect(organize).toHaveBeenLastCalledWith(local.id)
      expect(wrapper.get('[data-testid="handoff-ai-summary"]').text()).toContain(
        'AI historical summary'
      )
      expect(wrapper.get('[data-testid="handoff-ai-summary"]').text()).toContain(
        'configured-provider / configured-model'
      )
    } finally {
      wrapper.unmount()
    }
  })
  it('discards a late AI summary after the preview is closed', async () => {
    const { wrapper, items, preview, organize } = setupProjectResolution(async () => ({
      status: 'available',
      path: '/project/a'
    }))
    const local = localHandoff(items[0]!)
    preview.mockResolvedValue(local)
    let finish!: (value: SessionHandoff) => void
    organize.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    try {
      await flushPromises()
      await wrapper.get(`[data-testid="history-session-${items[0]!.id}"]`).trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
      await flushPromises()
      await wrapper.get('textarea').setValue(local.instruction)
      await wrapper
        .findAll('button')
        .find((b) => b.text() === 'Prepare handoff')!
        .trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="handoff-ai-organize"]').trigger('click')
      expect(wrapper.get('[data-testid="handoff-confirm"]').attributes('disabled')).toBeDefined()
      await wrapper.get('[data-testid="close-preview"]').trigger('click')
      finish({
        ...local,
        aiSummary: {
          text: 'Wrong late summary',
          provider: 'test',
          modelId: 'test',
          createdAt: '2026-10-11'
        }
      })
      await flushPromises()
      expect(wrapper.text()).not.toContain('Wrong late summary')
    } finally {
      wrapper.unmount()
    }
  })
  it.each(['missing', 'unrecorded'] as const)(
    'asks for a replacement only when the directory is %s',
    async (status) => {
      const { wrapper, items, map } = setupProjectResolution(async () => ({ status }))
      try {
        await flushPromises()
        await wrapper.get(`[data-testid="history-session-${items[0]!.id}"]`).trigger('click')
        await flushPromises()
        await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
        await flushPromises()
        expect(wrapper.get('[data-testid="handoff-project"]').text()).toContain(
          universalMessages['en-US'][status === 'missing' ? 'projectMissing' : 'projectUnrecorded']
        )
        expect(wrapper.find('[data-testid="handoff-project"] select').exists()).toBe(true)
        await wrapper.get('textarea').setValue('Continue task a')
        expect(
          wrapper
            .findAll('button')
            .find((b) => b.text() === 'Prepare handoff')!
            .attributes('disabled')
        ).toBeDefined()
        expect(map).not.toHaveBeenCalled()
      } finally {
        wrapper.unmount()
      }
    }
  )
  it('discards directory resolution after switching conversations', async () => {
    let finish!: (value: UniversalProjectResolution) => void
    const { wrapper, items } = setupProjectResolution((id) =>
      id === 'a'.repeat(64)
        ? new Promise((resolve) => {
            finish = resolve
          })
        : Promise.resolve({ status: 'available', path: '/project/b' })
    )
    try {
      await flushPromises()
      await wrapper.get(`[data-testid="history-session-${items[0]!.id}"]`).trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
      await wrapper.get('[data-testid="close-preview"]').trigger('click')
      await wrapper.get(`[data-testid="history-session-${items[1]!.id}"]`).trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
      await flushPromises()
      finish({ status: 'available', path: '/project/a' })
      await flushPromises()
      expect(wrapper.get('[data-testid="handoff-project-path"]').text()).toBe('/project/b')
    } finally {
      wrapper.unmount()
    }
  })
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
        resolveProject: async (id: string) => ({
          status: 'available',
          path: items.find((s) => s.id === id)!.workspacePath
        }),
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
      await wrapper
        .get(`[data-testid="history-session-${items[0]!.id}"]`)
        .get('.history-session-title')
        .trigger('click')
      await flushPromises()
      expect(preview).not.toHaveBeenCalled()
      expect(continueTask).not.toHaveBeenCalled()
      await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
      await flushPromises()
      await wrapper.get('textarea').setValue('Continue task a')
      await clickText('Prepare handoff')
      expect(preview).toHaveBeenCalledWith(items[0]!.id, 'Continue task a')
      await wrapper.get('[data-testid="close-preview"]').trigger('click')
      await wrapper.get(`[data-testid="history-session-${items[1]!.id}"]`).trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="history-continue-task"]').trigger('click')
      await flushPromises()
      resolvePreview({
        instruction: 'Continue task a',
        goal: { text: 'Wrong old task' }
      } as SessionHandoff)
      await flushPromises()
      expect(wrapper.text()).not.toContain('Wrong old task')
      expect(wrapper.get('textarea').element.value).toBe(
        universalMessages['en-US'].defaultInstruction
      )
      expect(wrapper.get('[data-testid="handoff-confirm"]').attributes('disabled')).toBeDefined()
      expect(continueTask).not.toHaveBeenCalled()
    } finally {
      wrapper.unmount()
    }
  })
})
