import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '@renderer/i18n'
import { useAgentStore } from '@renderer/stores/agent'
import { useModelsStore } from '@renderer/stores/models'
import { useProvidersStore } from '@renderer/stores/providers'
import { useSessionStore } from '@renderer/stores/sessions'
import { useSettingsStore } from '@renderer/stores/settings'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import type { ModelDefinition, ProviderProfile } from '@shared/ipc/api-types'
import ChatComposer from './ChatComposer.vue'

beforeEach(() => setActivePinia(createPinia()))

describe('ChatComposer model capabilities', () => {
  it('only enables image input for models that declare vision support', async () => {
    const models = useModelsStore()
    const providers = useProvidersStore()
    const workspace = useWorkspaceStore()
    providers.items = [provider()]
    models.items = [model('text-only', false), model('vision', true)]
    models.active = { providerKey: 'provider', modelId: 'text-only' }

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
    workspace.draft = 'draw a lighthouse'

    const wrapper = mount(ChatComposer, {
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    const attach = wrapper.get(`button[aria-label="${i18n.global.t('workspace.attachImage')}"]`)
    expect(attach.attributes('disabled')).toBeUndefined()

    await wrapper.get('.command-execute-button').trigger('click')

    expect(wrapper.emitted('send')).toEqual([
      [{ providerKey: 'provider', modelId: 'step-image-edit-2' }]
    ])
  })
})

describe('ChatComposer compact button', () => {
  it('stays clickable for a short or busy session', async () => {
    const sessions = useSessionStore()
    const agent = useAgentStore()
    sessions.addTransientSession('session-1', '/code/project', 'hello')
    sessions.selectSession('session-1')
    agent.sending = true
    agent.streaming = { ...agent.streaming, isStreaming: true }

    const wrapper = mount(ChatComposer, {
      props: { soundEnabled: false },
      global: { plugins: [i18n] }
    })
    const button = wrapper.get('[data-testid="composer-compact"]')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.text()).toContain(String(i18n.global.t('workspace.compactAfterTask')))
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
