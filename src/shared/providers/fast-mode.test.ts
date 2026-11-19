import { describe, expect, it } from 'vitest'
import { supportsFastMode, withFastServiceTier } from './fast-mode'
import { latestModelIds } from './latest-models'

describe('fast mode', () => {
  it('is offered on GPT models from OpenAI and ChatGPT accounts only', () => {
    const openai = { key: 'openai', baseUrl: 'https://api.openai.com/v1' }
    expect(supportsFastMode(openai, 'gpt-6.2-sol')).toBe(true)
    expect(supportsFastMode(openai, 'o3')).toBe(true)
    expect(supportsFastMode(openai, 'text-embedding-3-large')).toBe(false)
    expect(supportsFastMode({ key: 'chatgpt-account-1' }, 'gpt-6.1-terra')).toBe(true)
    expect(supportsFastMode({ key: 'relay', baseUrl: 'https://relay.test/v1' }, 'gpt-6')).toBe(
      false
    )
  })

  it('adds the priority tier without overriding an explicit one', () => {
    expect(JSON.parse(withFastServiceTier('{"model":"gpt-6.2-sol","stream":true}')!)).toEqual({
      model: 'gpt-6.2-sol',
      stream: true,
      service_tier: 'priority'
    })
    expect(withFastServiceTier('{"model":"gpt-6.2-sol","service_tier":"flex"}')).toBeUndefined()
    expect(withFastServiceTier('{"model":"deepseek-flash"}')).toBeUndefined()
    expect(withFastServiceTier('not json')).toBeUndefined()
  })
})

describe('latest models', () => {
  it("uses Codex's set for OpenAI and each vendor's catalog elsewhere", () => {
    expect([
      ...latestModelIds({
        key: 'openai',
        protocol: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1'
      })!
    ]).toEqual([
      'gpt-6.2-sol',
      'gpt-6.2-astra',
      'gpt-6.1-terra',
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna'
    ])
    expect(
      latestModelIds({
        key: 'deepseek',
        protocol: 'openai-completions',
        baseUrl: 'https://api.deepseek.com'
      })?.has('deepseek-v4-pro')
    ).toBe(true)
    expect(
      latestModelIds({
        key: 'ollama',
        protocol: 'openai-completions',
        baseUrl: 'http://127.0.0.1:11434/v1'
      })
    ).toBeUndefined()
  })
})
