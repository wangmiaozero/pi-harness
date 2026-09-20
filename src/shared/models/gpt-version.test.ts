import { describe, expect, it } from 'vitest'
import { isGptAtLeast, parseGptVersion } from './gpt-version'

describe('GPT version', () => {
  it('reads dotted and compact GPT ids', () => {
    expect(parseGptVersion('openai/gpt-5.6')).toEqual({ major: 5, minor: 6 })
    expect(parseGptVersion('GPT-5.6-codex')).toEqual({ major: 5, minor: 6 })
    expect(parseGptVersion('openai::gpt5.6')).toEqual({ major: 5, minor: 6 })
    expect(parseGptVersion('gpt-5')).toEqual({ major: 5, minor: 0 })
    expect(parseGptVersion('gpt-6-mini')).toEqual({ major: 6, minor: 0 })
  })

  it('ignores non-GPT and ChatGPT-prefixed names', () => {
    expect(parseGptVersion('volcengine-coding/glm-5.3')).toBeNull()
    expect(parseGptVersion('chatgpt-4o')).toBeNull()
    expect(parseGptVersion('o4-mini')).toBeNull()
  })

  it('treats GPT 5.6 and above as the divine-audience threshold', () => {
    expect(isGptAtLeast('openai/gpt-5.6', 5, 6)).toBe(true)
    expect(isGptAtLeast('gpt-5.7', 5, 6)).toBe(true)
    expect(isGptAtLeast('gpt-6', 5, 6)).toBe(true)
    expect(isGptAtLeast('gpt-5.5', 5, 6)).toBe(false)
    expect(isGptAtLeast('gpt-5', 5, 6)).toBe(false)
    expect(isGptAtLeast('nvidia/glm-5.3', 5, 6)).toBe(false)
  })
})
