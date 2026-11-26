import {
  DOMWrapper,
  enableAutoUnmount,
  flushPromises,
  mount,
  type VueWrapper
} from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@renderer/i18n'
import { useAgentStore } from '@renderer/stores/agent'
import { useCompactionStore } from '@renderer/stores/compaction'
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

enableAutoUnmount(afterEach)

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
  delete window.piSwitch
  vi.restoreAllMocks()
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
    await openAddMenu(wrapper)
    await addMenuItem('composer-skill-trigger').trigger('click')
    await flushPromises()

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

async function openAddMenu(wrapper: VueWrapper) {
  await wrapper.get('[data-testid="composer-add"]').trigger('keydown', { key: 'Enter' })
  await flushPromises()
}

function addMenuItem(testId: string) {
  return new DOMWrapper(document.body).get(`[data-testid="${testId}"]`)
}

describe('ChatComposer Add menu', () => {
  it('applies and clears Goal and Plan choices for the normal send action', async () => {
    const workspace = useWorkspaceStore()
    workspace.projectRoots = ['/code/test']
    workspace.pickedCwd = '/code/test'
    workspace.draft = 'Inspect this'
    const wrapper = mount(ChatComposer, {
      attachTo: document.body,
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    for (const mode of ['goal', 'plan'] as const) {
      await openAddMenu(wrapper)
      const choice = addMenuItem(`composer-mode-${mode}`)
      expect(choice.attributes('aria-checked')).toBe('false')
      await choice.trigger('click')
      await wrapper.get('.command-execute-button').trigger('click')
      expect(wrapper.emitted('send')?.at(-1)).toEqual([null, mode])

      await openAddMenu(wrapper)
      const selected = addMenuItem(`composer-mode-${mode}`)
      expect(selected.attributes('aria-checked')).toBe('true')
      await selected.trigger('click')
      await wrapper.get('.command-execute-button').trigger('click')
      expect(wrapper.emitted('send')?.at(-1)).toEqual([null, 'agent'])
    }
  })
})

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
      attachTo: document.body,
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    await openAddMenu(wrapper)
    const attach = addMenuItem('composer-add-image')
    expect(attach.attributes('data-disabled')).toBeDefined()

    models.active = { providerKey: 'provider', modelId: 'vision' }
    await wrapper.vm.$nextTick()
    expect(attach.attributes('data-disabled')).toBeUndefined()

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
      attachTo: document.body,
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    await openAddMenu(wrapper)
    const attach = addMenuItem('composer-add-image')
    expect(attach.attributes('data-disabled')).toBeUndefined()

    await wrapper.get('.command-execute-button').trigger('click')

    expect(wrapper.emitted('send')).toEqual([
      [{ providerKey: 'provider', modelId: 'step-image-edit-2' }, 'agent']
    ])
  })
})

describe('ChatComposer manual compaction', () => {
  it('compacts the current session from the Add menu', async () => {
    const sessions = useSessionStore()
    const compaction = useCompactionStore()
    const request = vi.spyOn(compaction, 'requestSmartCompaction').mockResolvedValue({
      status: 'compacted'
    })
    const wrapper = mount(ChatComposer, {
      attachTo: document.body,
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    await openAddMenu(wrapper)
    const button = addMenuItem('composer-compact')
    expect(button.attributes('data-disabled')).toBeDefined()

    sessions.addTransientSession('session-1', '/code/project', 'hello')
    sessions.selectSession('session-1')
    await wrapper.vm.$nextTick()
    expect(button.attributes('data-disabled')).toBeUndefined()
    await button.trigger('click')
    expect(request).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session-1', force: true })
  })

  it('disables manual compaction while the current task is running', async () => {
    const sessions = useSessionStore()
    const agent = useAgentStore()
    sessions.addTransientSession('session-1', '/code/project', 'hello')
    sessions.selectSession('session-1')
    agent.sending = true
    agent.sendingSessionId = 'session-1'
    agent.runningIds = ['session-1']
    agent.streaming = { ...agent.streaming, isStreaming: true }

    const wrapper = mount(ChatComposer, {
      attachTo: document.body,
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    await openAddMenu(wrapper)
    expect(addMenuItem('composer-compact').attributes('data-disabled')).toBeDefined()
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

  it('keeps text typed into the focused editor across a session switch', async () => {
    const sessions = useSessionStore()
    const workspace = useWorkspaceStore()
    sessions.addTransientSession('chat-a', '/code/a', 'A')
    sessions.addTransientSession('chat-b', '/code/b', 'B')
    sessions.selectSession('chat-a')
    const wrapper = mount(ChatComposer, {
      attachTo: document.body,
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    const editor = wrapper.get('[data-testid="composer-editor"]')
    ;(editor.element as HTMLElement).focus()
    editor.element.textContent = 'Check the first message'
    sessions.selectSession('chat-b')
    sessions.selectSession('chat-a')
    await wrapper.vm.$nextTick()
    expect(editor.element.textContent).toBe('Check the first message')
    workspace.draft = 'from the store'
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(editor.element.textContent).toBe('from the store')
    wrapper.unmount()
  })
})

describe('ChatComposer ultra fire border', () => {
  it('puts BURNING BORDER on the input box only in ultra', async () => {
    const agent = useAgentStore()
    const settings = useSettingsStore()
    settings.settings = { composerFireEnabled: true } as NonNullable<typeof settings.settings>
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

  it('keeps the flame off by default in ultra', () => {
    const agent = useAgentStore()
    agent.thinkingLevel = 'ultra'
    const wrapper = mount(ChatComposer, {
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    expect(wrapper.find('[data-testid="agent-aura-fire-border"]').exists()).toBe(false)
    expect(wrapper.get('.command-console-input').classes()).not.toContain(
      'command-console-input--ultra'
    )
  })

  it('removes the flame and restores the normal input style when disabled', async () => {
    const agent = useAgentStore()
    const settings = useSettingsStore()
    agent.thinkingLevel = 'ultra'
    settings.settings = { composerFireEnabled: true } as NonNullable<typeof settings.settings>
    const wrapper = mount(ChatComposer, {
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    expect(wrapper.find('[data-testid="agent-aura-fire-border"]').exists()).toBe(true)

    settings.settings.composerFireEnabled = false
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

describe('ChatComposer image drafts', () => {
  beforeEach(() => {
    const models = useModelsStore()
    const providers = useProvidersStore()
    const workspace = useWorkspaceStore()
    providers.items = [provider()]
    models.items = [model('vision', true)]
    models.active = { providerKey: 'provider', modelId: 'vision' }
    workspace.projectRoots = ['/code/test']
    workspace.pickedCwd = '/code/test'
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(() => undefined)
  })

  async function selectImage(wrapper: VueWrapper) {
    const input = wrapper.get('input[type="file"]')
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', {
      type: 'image/png'
    })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
  }

  async function finishReading() {
    const reader = vi.mocked(FileReader.prototype.readAsDataURL).mock.contexts[0] as FileReader
    Object.defineProperty(reader, 'result', { value: 'data:image/png;base64,iVBORw==' })
    reader.dispatchEvent(new ProgressEvent('load'))
    await flushPromises()
  }

  function mountComposer() {
    return mount(ChatComposer, {
      attachTo: document.body,
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
  }

  function startRunning() {
    const sessions = useSessionStore()
    sessions.addTransientSession('session-1', '/code/project', 'hello')
    sessions.selectSession('session-1')
    useAgentStore().runningIds = ['session-1']
    return sessions
  }

  it.each(['Please review the screenshot', ''])(
    'keeps the image in the draft during a run until Enter submits it with %j',
    async (text) => {
      startRunning()
      const workspace = useWorkspaceStore()
      const wrapper = mountComposer()
      const editor = wrapper.get('[data-testid="composer-editor"]')
      await selectImage(wrapper)
      expect(document.activeElement).toBe(editor.element)
      editor.element.textContent = text
      await editor.trigger('input')
      expect(workspace.draft).toBe(text)
      await editor.trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('send')).toBeUndefined()

      await finishReading()
      expect(workspace.draftImages).toHaveLength(1)
      expect(wrapper.emitted('send')).toBeUndefined()
      expect(wrapper.find('[data-testid="composer-follow-up-queue"]').exists()).toBe(false)

      await editor.trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('send')).toEqual([[null, 'agent']])
    }
  )

  it('keeps attachments with the original chat if the user switches chats during the read', async () => {
    const sessions = startRunning()
    const workspace = useWorkspaceStore()
    const wrapper = mountComposer()
    await selectImage(wrapper)

    sessions.addTransientSession('session-2', '/code/project', 'second chat')
    sessions.selectSession('session-2')
    await finishReading()
    expect(workspace.draftImages).toHaveLength(0)

    sessions.selectSession('session-1')
    await flushPromises()
    expect(workspace.draftImages.map((image) => image.name)).toEqual(['shot.png'])
    await wrapper
      .get(`button[aria-label="${i18n.global.t('workspace.removeImage')}"]`)
      .trigger('click')
    expect(workspace.draftImages).toHaveLength(0)
  })
})
