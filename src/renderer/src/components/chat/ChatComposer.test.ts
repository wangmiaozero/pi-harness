import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '@renderer/i18n'
import { useModelsStore } from '@renderer/stores/models'
import { useProvidersStore } from '@renderer/stores/providers'
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
    const attach = wrapper.get('button[aria-label="附加图片"]')
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
    expect(wrapper.text()).toContain('当前模型不支持图片输入，请切换到多模态模型。')
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
