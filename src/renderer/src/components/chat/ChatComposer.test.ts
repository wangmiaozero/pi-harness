import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@renderer/i18n'
import { useAgentStore } from '@renderer/stores/agent'
import { useModelsStore } from '@renderer/stores/models'
import { useProvidersStore } from '@renderer/stores/providers'
import { useSessionStore } from '@renderer/stores/sessions'
import { useSettingsStore } from '@renderer/stores/settings'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useSkillsStore } from '@renderer/stores/skills'
import type { ModelDefinition, PiSwitchAPI, ProviderProfile } from '@shared/ipc/api-types'
import ChatComposer from './ChatComposer.vue'
vi.mock('@renderer/features/agent-settings/WorkspaceVoiceControl.vue', () => ({
  default: { template: '<button aria-label="Realtime voice" />' }
}))
import ComposerModelPicker from './ComposerModelPicker.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  window.piSwitch = {
    on: vi.fn(() => () => undefined),
    skills: {
      list: vi.fn(() => Promise.resolve([...useSkillsStore().skills]))
    }
  } as unknown as PiSwitchAPI
})

afterEach(() => {
  document.body.innerHTML = ''
  delete window.piSwitch
})

describe('ChatComposer skill mentions', () => {
  it('filters installed Skills after @ and selects with the keyboard', async () => {
    const skills = useSkillsStore()
    const workspace = useWorkspaceStore()
    skills.skills = [
      skill('apple-design', 'Apple platform design guidance'),
      skill('backend-review', 'Review backend services')
    ]

    const wrapper = mount(ChatComposer, {
      attachTo: document.body,
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    const input = wrapper.get('[data-testid="composer-editor"]')
    input.element.textContent = 'Please use @apple'
    setContentSelection(input.element, 17)
    await input.trigger('input')

    const menu = document.body.querySelector('[data-testid="composer-skill-menu"]')
    expect(menu?.textContent).toContain('@apple-design')
    expect(menu?.textContent).not.toContain('backend-review')

    await input.trigger('keydown', { key: 'Enter', keyCode: 13 })
    expect(workspace.draft).toBe('Please use')
    expect(workspace.draftSkill).toBe('apple-design')
    expect(wrapper.get('[data-testid="composer-skill-chip"]').text()).toContain('@apple-design')
    expect(document.body.querySelector('[data-testid="composer-skill-menu"]')).toBeNull()

    await wrapper.get('[data-testid="composer-skill-chip"] button').trigger('click')
    expect(workspace.draftSkill).toBeNull()
    expect(wrapper.find('[data-testid="composer-skill-chip"]').exists()).toBe(false)
  })

  it('removes the selected Skill chip with Backspace at the start of the prompt', async () => {
    const workspace = useWorkspaceStore()
    workspace.draftSkill = 'demo-skill'

    const wrapper = mount(ChatComposer, {
      attachTo: document.body,
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    const input = wrapper.get('[data-testid="composer-editor"]')
    setContentSelection(input.element, 0)
    await input.trigger('keydown', { key: 'Backspace' })

    expect(workspace.draftSkill).toBeNull()
  })

  it('opens the Skill menu from the toolbar button at the current caret', async () => {
    const skills = useSkillsStore()
    const workspace = useWorkspaceStore()
    skills.skills = [skill('demo-skill', 'Demo')]
    workspace.draft = 'Review this'

    const wrapper = mount(ChatComposer, {
      attachTo: document.body,
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    await wrapper.vm.$nextTick()
    const input = wrapper.get('[data-testid="composer-editor"]')
    setContentSelection(input.element, 11)
    await wrapper.get('[data-testid="composer-skill-trigger"]').trigger('click')

    expect(workspace.draft).toBe('Review this @')
    expect(document.body.querySelector('[data-testid="composer-skill-menu"]')).not.toBeNull()
  })
})

function setContentSelection(element: Element, offset: number) {
  const node = element.firstChild ?? element.appendChild(document.createTextNode(''))
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

describe('ChatComposer model capabilities', () => {
  it('only enables image input for models that declare vision support', async () => {
    const models = useModelsStore()
    const providers = useProvidersStore()
    const workspace = useWorkspaceStore()
    providers.items = [provider()]
    models.items = [model('text-only', false), model('vision', true)]
    models.active = { providerKey: 'provider', modelId: 'text-only' }
    workspace.projectRoots = ['/code/test']
    workspace.pickedCwd = '/code/test'

    const wrapper = mount(ChatComposer, {
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    const attach = wrapper.get(`button[aria-label="${i18n.global.t('workspace.attachImage')}"]`)
    expect(attach.attributes('disabled')).toBeDefined()

    models.active = { providerKey: 'provider', modelId: 'vision' }
    await wrapper.vm.$nextTick()
    expect(attach.attributes('disabled')).toBeUndefined()

    workspace.addDraftImages([
      {
        id: 'image-1',
        name: 'image.png',
        size: 1,
        type: 'image',
        data: 'TQ==',
        mimeType: 'image/png'
      }
    ])
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.command-execute-button').attributes('disabled')).toBeUndefined()

    models.active = { providerKey: 'provider', modelId: 'text-only' }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.command-execute-button').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain(String(i18n.global.t('workspace.imageUnsupported')))
  })

  it('routes dedicated image models as image requests from the composer', async () => {
    const models = useModelsStore()
    const providers = useProvidersStore()
    const workspace = useWorkspaceStore()
    providers.items = [provider()]
    models.items = [model('step-image-edit-2', false)]
    models.active = { providerKey: 'provider', modelId: 'step-image-edit-2' }
    workspace.projectRoots = ['/code/test']
    workspace.pickedCwd = '/code/test'
    workspace.draft = 'draw a lighthouse'

    const wrapper = mount(ChatComposer, {
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    const attach = wrapper.get(`button[aria-label="${i18n.global.t('workspace.attachImage')}"]`)
    expect(attach.attributes('disabled')).toBeUndefined()

    await wrapper.get('.command-execute-button').trigger('click')

    expect(wrapper.emitted('send')).toEqual([
      [{ providerKey: 'provider', modelId: 'step-image-edit-2' }, 'agent']
    ])
  })
})

describe('ChatComposer automatic compaction', () => {
  it('has no manual compaction action while retaining task controls', async () => {
    const sessions = useSessionStore()
    const agent = useAgentStore()
    sessions.addTransientSession('session-1', '/code/project', 'hello')
    sessions.selectSession('session-1')
    agent.sending = true
    agent.sendingSessionId = 'session-1'
    agent.runningIds = ['session-1']
    agent.streaming = { ...agent.streaming, isStreaming: true }

    const wrapper = mount(ChatComposer, {
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    await wrapper.get('[data-testid="composer-more"]').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    const button = document.querySelector<HTMLButtonElement>('[data-testid="composer-compact"]')
    expect(button).toBeNull()
    await wrapper.get('[data-testid="composer-abort"]').trigger('click')
    expect(wrapper.emitted('abort')).toHaveLength(1)
  })
})

describe('ChatComposer submission lock', () => {
  it('blocks editing, paste and duplicate sends until submission settles', async () => {
    const workspace = useWorkspaceStore()
    workspace.projectRoots = ['/code/test']
    workspace.pickedCwd = '/code/test'
    workspace.draft = 'Original message'
    const wrapper = mount(ChatComposer, {
      props: { soundEnabled: false, submitting: true },
      global: { plugins: [i18n] }
    })
    const editor = wrapper.get('[data-testid="composer-editor"]')
    expect(editor.attributes('contenteditable')).toBe('false')
    expect(editor.attributes('aria-disabled')).toBe('true')
    expect(wrapper.get('.command-execute-button').attributes('disabled')).toBeDefined()
    await editor.trigger('keydown', { key: 'Enter' })
    await editor.trigger('paste', { clipboardData: { items: [], getData: () => 'late edit' } })
    expect(workspace.draft).toBe('Original message')
    expect(wrapper.emitted('send')).toBeUndefined()
    await wrapper.setProps({ submitting: false })
    expect(editor.attributes('contenteditable')).toBe('plaintext-only')
    expect(wrapper.get('.command-execute-button').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('scopes a pending agent submission to its conversation', async () => {
    const sessions = useSessionStore()
    const agent = useAgentStore()
    sessions.addTransientSession('sending-chat', '/code/a', 'A')
    sessions.addTransientSession('other-chat', '/code/b', 'B')
    sessions.selectSession('sending-chat')
    agent.sending = true
    agent.sendingSessionId = 'sending-chat'
    const wrapper = mount(ChatComposer, {
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    expect(wrapper.get('[data-testid="composer-editor"]').attributes('contenteditable')).toBe(
      'false'
    )
    sessions.selectSession('other-chat')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="composer-editor"]').attributes('contenteditable')).toBe(
      'plaintext-only'
    )
    wrapper.unmount()
  })
})

describe('ChatComposer ultra fire border', () => {
  it('puts BURNING BORDER on the input box only in ultra', async () => {
    const agent = useAgentStore()
    const wrapper = mount(ChatComposer, {
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    expect(wrapper.find('[data-testid="agent-aura-fire-border"]').exists()).toBe(false)

    agent.thinkingLevel = 'ultra'
    await wrapper.vm.$nextTick()
    const fire = wrapper.get('[data-testid="agent-aura-fire-border"]')
    expect(wrapper.get('.command-console-input').classes()).toContain(
      'command-console-input--ultra'
    )
    expect(wrapper.get('[data-testid="chat-composer"]').classes()).toContain(
      'command-console--ultra'
    )
    expect(fire.element.parentElement?.querySelector('.command-console-input')).toBeTruthy()
  })

  it('removes the flame and restores the normal input style when disabled', async () => {
    const agent = useAgentStore()
    const settings = useSettingsStore()
    agent.thinkingLevel = 'ultra'
    const wrapper = mount(ChatComposer, {
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    expect(wrapper.find('[data-testid="agent-aura-fire-border"]').exists()).toBe(true)

    settings.settings = { composerFireEnabled: false } as NonNullable<typeof settings.settings>
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="agent-aura-fire-border"]').exists()).toBe(false)
    expect(wrapper.get('.command-console-input').classes()).not.toContain(
      'command-console-input--ultra'
    )
    expect(wrapper.get('[data-testid="chat-composer"]').classes()).not.toContain(
      'command-console--ultra'
    )
    expect(agent.thinkingLevel).toBe('ultra')

    settings.settings.composerFireEnabled = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="agent-aura-fire-border"]').exists()).toBe(true)
  })
})

function provider(): ProviderProfile {
  return {
    id: 'provider-id',
    key: 'provider',
    name: 'Provider',
    displayName: 'Provider',
    enabled: true,
    protocol: 'openai-completions',
    baseUrl: 'https://example.com',
    apiKeyRef: null,
    apiKey: null,
    headers: {},
    authHeader: true,
    timeout: null,
    defaultModelId: null,
    modelCount: 2,
    createdAt: 0,
    updatedAt: 0
  }
}

function model(modelId: string, vision: boolean): ModelDefinition {
  return {
    id: `provider-id:${modelId}`,
    providerId: 'provider-id',
    modelId,
    displayName: modelId,
    protocol: 'openai-completions',
    enabled: true,
    capabilities: { text: true, vision },
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    reasoning: false,
    vision,
    tools: true,
    streaming: true,
    thinkingLevels: null,
    metadata: {},
    createdAt: 0,
    updatedAt: 0
  }
}

function skill(name: string, description: string) {
  return {
    name,
    description,
    path: `/skills/${name}`,
    source: '/skills',
    isValid: true,
    issues: [],
    lastModified: null,
    hasReadme: true,
    origin: 'local' as const,
    scope: 'global' as const
  }
}

describe('ChatComposer OpenCode catalog visibility', () => {
  it.each([
    { hasCredential: true, showInWorkspace: undefined, workspaceModelIds: ['big-pickle'] },
    { hasCredential: true, showInWorkspace: false, workspaceModelIds: ['big-pickle'] },
    { hasCredential: false, showInWorkspace: true, workspaceModelIds: ['big-pickle'] },
    { hasCredential: true, showInWorkspace: true, workspaceModelIds: [] }
  ])(
    'hides OpenCode native and catalog rows unless explicitly selected with a key: %j',
    async (preferences) => {
      useProvidersStore().items = [
        provider(),
        { ...provider(), id: 'opencode-free', key: 'opencode-free', displayName: 'OpenCode' }
      ]
      useModelsStore().items = [
        model('normal', false),
        {
          ...model('big-pickle', false),
          id: 'opencode-free:big-pickle',
          providerId: 'opencode-free'
        }
      ]
      window.piSwitch!.openCodeFree = {
        state: vi.fn(async () => ({
          schemaVersion: 2,
          enabled: true,
          ...preferences,
          models: [{ id: 'big-pickle', name: 'Big Pickle', price: 'free' }]
        }))
      } as unknown as PiSwitchAPI['openCodeFree']
      const wrapper = mount(ChatComposer, {
        attachTo: document.body,
        props: { soundEnabled: false },
        global: { plugins: [i18n] }
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      await wrapper.vm.$nextTick()
      const options = wrapper.getComponent(ComposerModelPicker).props('options')
      expect(options.map((option) => option.value)).toEqual(['provider/normal'])
      wrapper.unmount()
    }
  )
  it('shows a restricted OpenCode group even when it has no registered native models', async () => {
    const setActive = vi.spyOn(useModelsStore(), 'setActive')
    window.piSwitch!.openCodeFree = {
      state: vi.fn(async () => ({
        schemaVersion: 2,
        enabled: true,
        hasCredential: true,
        showInWorkspace: true,
        workspaceModelIds: ['big-pickle'],
        authMode: 'inference',
        credentials: [{ id: 'default', name: 'Personal' }],
        activeCredentialId: 'default',
        connectionStatus: 'FREE_TIER_RESTRICTED',
        httpStatus: 403,
        authorizedModels: ['big-pickle'],
        allowedPaidModels: [],
        selectedModel: null,
        refreshedAt: Date.now(),
        error: 'FREE_TIER_RESTRICTED',
        models: [
          {
            id: 'big-pickle',
            name: 'Big Pickle',
            price: 'free',
            available: true,
            api: 'openai-completions',
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 32000,
            input: ['text'],
            reasoning: true,
            streaming: 'not_verified',
            tools: 'not_verified',
            checkedAt: Date.now(),
            status: 'restricted',
            errorCode: 'FREE_TIER_RESTRICTED'
          },
          { id: 'not-chosen', name: 'Not chosen', price: 'free', available: true }
        ]
      }))
    } as unknown as PiSwitchAPI['openCodeFree']
    const wrapper = mount(ChatComposer, {
      attachTo: document.body,
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    await wrapper.getComponent(ComposerModelPicker).get('button').trigger('click')
    expect(document.body.querySelector('[data-select-cascade-group="OpenCode"]')).toBeTruthy()
    const option = document.body.querySelector<HTMLButtonElement>('[role="option"]')!
    expect(option.textContent).toContain('Big Pickle')
    expect(option.textContent).toContain(
      String(i18n.global.t('openCode.errors.FREE_TIER_RESTRICTED'))
    )
    expect(document.body.querySelector('[role="listbox"]')?.textContent).not.toContain('Not chosen')
    expect(option.disabled).toBe(true)
    option.click()
    await wrapper.vm.$nextTick()
    expect(setActive).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('ChatComposer paste queue', () => {
  beforeEach(() => {
    const models = useModelsStore()
    const providers = useProvidersStore()
    const workspace = useWorkspaceStore()
    providers.items = [provider()]
    models.items = [model('vision', true)]
    models.active = { providerKey: 'provider', modelId: 'vision' }
    workspace.projectRoots = ['/code/test']
    workspace.pickedCwd = '/code/test'
  })

  function pngFile(name: string): File {
    return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' })
  }

  async function attachPngs(
    wrapper: VueWrapper,
    count: number,
    until?: () => boolean
  ): Promise<void> {
    const input = wrapper.get('input[type="file"]')
    const files = Array.from({ length: count }, (_, index) => pngFile(`shot-${index}.png`))
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')
    for (let tick = 0; tick < 100 && !(until?.() ?? false); tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await wrapper.vm.$nextTick()
    }
  }

  function mountComposer() {
    return mount(ChatComposer, {
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
  }

  it('queues pasted images while the agent is busy and sends the whole queue at once', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    const agent = useAgentStore()
    sessions.addTransientSession('session-1', '/code/project', 'hello')
    sessions.selectSession('session-1')
    agent.runningIds = ['session-1']

    const wrapper = mountComposer()
    await attachPngs(wrapper, 2, () =>
      wrapper.find('[data-testid="composer-paste-queue"]').exists()
    )

    expect(workspace.draftImages).toHaveLength(0)
    const queue = wrapper.get('[data-testid="composer-paste-queue"]')
    expect(queue.text()).toContain('2/2')

    await wrapper
      .get(`button[aria-label="${i18n.global.t('workspace.pasteQueuePrev')}"]`)
      .trigger('click')
    expect(queue.text()).toContain('1/2')
    await wrapper
      .get(`button[aria-label="${i18n.global.t('workspace.pasteQueueNext')}"]`)
      .trigger('click')
    expect(queue.text()).toContain('2/2')

    await wrapper.get('[data-testid="composer-paste-queue-send"]').trigger('click')
    expect(wrapper.emitted('sendQueue')).toHaveLength(1)
    const payload = wrapper.emitted('sendQueue')![0][0] as Array<{ type: string; data: string }>
    expect(payload).toHaveLength(2)
    expect(payload.every((image) => image.type === 'image' && image.data.length > 0)).toBe(true)
    expect(wrapper.find('[data-testid="composer-paste-queue"]').exists()).toBe(false)
  })

  it('keeps idle pastes as direct attachments', async () => {
    const workspace = useWorkspaceStore()

    const wrapper = mountComposer()
    await attachPngs(wrapper, 1, () => workspace.draftImages.length === 1)

    expect(workspace.draftImages).toHaveLength(1)
    expect(wrapper.find('[data-testid="composer-paste-queue"]').exists()).toBe(false)
  })

  it('moves a queued item back to the attachment drafts with the edit action', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    const agent = useAgentStore()
    sessions.addTransientSession('session-1', '/code/project', 'hello')
    sessions.selectSession('session-1')
    agent.runningIds = ['session-1']

    const wrapper = mountComposer()
    await attachPngs(wrapper, 1, () =>
      wrapper.find('[data-testid="composer-paste-queue"]').exists()
    )

    await wrapper
      .get(`button[aria-label="${i18n.global.t('workspace.pasteQueueToDraft')}"]`)
      .trigger('click')
    expect(workspace.draftImages).toHaveLength(1)
    expect(wrapper.find('[data-testid="composer-paste-queue"]').exists()).toBe(false)
  })

  it('removes the current queue item without touching the drafts', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    const agent = useAgentStore()
    sessions.addTransientSession('session-1', '/code/project', 'hello')
    sessions.selectSession('session-1')
    agent.runningIds = ['session-1']

    const wrapper = mountComposer()
    await attachPngs(wrapper, 1, () =>
      wrapper.find('[data-testid="composer-paste-queue"]').exists()
    )

    await wrapper
      .get(`button[aria-label="${i18n.global.t('workspace.pasteQueueRemove')}"]`)
      .trigger('click')
    expect(workspace.draftImages).toHaveLength(0)
    expect(wrapper.find('[data-testid="composer-paste-queue"]').exists()).toBe(false)
  })
})
