import { describe, it, expect } from 'vitest'
import { normalizeProviderBaseUrl } from '@shared/utils/base-url'

describe('normalizeProviderBaseUrl', () => {
  it('strips /chat/completions', () => {
    const r = normalizeProviderBaseUrl('https://api.stepfun.com/step_plan/v1/chat/completions')
    expect(r.url).toBe('https://api.stepfun.com/step_plan/v1')
    expect(r.changed).toBe(true)
    expect(r.stripped).toMatch(/chat\/completions/i)
  })

  it('keeps clean roots', () => {
    const r = normalizeProviderBaseUrl('https://api.stepfun.com/step_plan/v1')
    expect(r.url).toBe('https://api.stepfun.com/step_plan/v1')
    expect(r.changed).toBe(false)
  })

  it('strips trailing slash', () => {
    const r = normalizeProviderBaseUrl('https://api.openai.com/v1/')
    expect(r.url).toBe('https://api.openai.com/v1')
  })
})
