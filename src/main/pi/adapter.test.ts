import { describe, expect, it } from 'vitest'
import { domainModelToPi, domainProviderToPi, syncInheritedModelApis } from './adapter'
import type { PiModelConfig } from '@shared/types/pi'

const models = (entries: Array<[string, string | undefined]>): PiModelConfig[] =>
  entries.map(([id, api]) => (api ? { id, name: id, api } : { id, name: id }))

describe('syncInheritedModelApis', () => {
  it('drops copied api so every model inherits the provider protocol', () => {
    expect(
      syncInheritedModelApis(
        models([
          ['chat-a', 'openai-completions'],
          ['chat-b', 'openai-completions']
        ]),
        'anthropic-messages',
        'openai-completions'
      ).map((model) => [model.id, model.api])
    ).toEqual([
      ['chat-a', undefined],
      ['chat-b', undefined]
    ])
  })

  it('leaves explicit per-model protocol overrides alone', () => {
    expect(
      syncInheritedModelApis(
        models([
          ['chat-a', 'openai-completions'],
          ['other', 'openai-responses']
        ]),
        'anthropic-messages',
        'openai-completions'
      ).map((model) => [model.id, model.api])
    ).toEqual([
      ['chat-a', undefined],
      ['other', 'openai-responses']
    ])
  })

  it('strips redundant api copies even when the provider protocol did not change', () => {
    expect(
      syncInheritedModelApis(
        models([['chat-a', 'anthropic-messages']]),
        'anthropic-messages',
        'anthropic-messages'
      ).map((model) => [model.id, model.api])
    ).toEqual([['chat-a', undefined]])
  })
})

describe('domainProviderToPi', () => {
  it('does not stamp provider protocol onto individual models', () => {
    const next = domainProviderToPi(
      {
        api: 'openai-completions',
        baseUrl: 'https://api.example.test/v1',
        models: models([
          ['chat-a', 'openai-completions'],
          ['other', 'google-generative-ai']
        ])
      },
      {
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.example.test/anthropic',
        headers: {},
        authHeader: true
      }
    )
    expect(next.api).toBe('anthropic-messages')
    expect(next.models?.map((model) => [model.id, model.api])).toEqual([
      ['chat-a', undefined],
      ['other', 'google-generative-ai']
    ])
  })
})

describe('domainModelToPi', () => {
  it('omits api when the model follows the provider protocol', () => {
    const next = domainModelToPi(
      undefined,
      {
        modelId: 'chat-a',
        displayName: 'chat-a',
        protocol: 'anthropic-messages',
        reasoning: false,
        vision: false,
        contextWindow: null,
        maxOutputTokens: null
      },
      'anthropic-messages'
    )
    expect(next.api).toBeUndefined()
  })

  it('writes api only for an explicit per-model override', () => {
    const next = domainModelToPi(
      { id: 'chat-a', api: 'anthropic-messages' },
      {
        modelId: 'chat-a',
        displayName: 'chat-a',
        protocol: 'openai-responses',
        reasoning: false,
        vision: false,
        contextWindow: null,
        maxOutputTokens: null
      },
      'anthropic-messages'
    )
    expect(next.api).toBe('openai-responses')
  })
})
