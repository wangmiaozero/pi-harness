import { describe, it, expect } from 'vitest'
import {
  isMissingModelCatalogMessage,
  normalizeProviderBaseUrl,
  volcenginePlanKind
} from '@shared/utils/base-url'

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

describe('volcenginePlanKind', () => {
  it('detects Agent Plan Anthropic roots', () => {
    expect(volcenginePlanKind('https://ark.cn-beijing.volces.com/api/plan')).toBe('agent-plan')
  })

  it('detects Coding Plan Anthropic roots', () => {
    expect(volcenginePlanKind('https://ark.cn-beijing.volces.com/api/coding')).toBe('coding-plan')
  })

  it('ignores pay-as-you-go Ark roots', () => {
    expect(volcenginePlanKind('https://ark.cn-beijing.volces.com/api/v3')).toBeNull()
  })
})

describe('isMissingModelCatalogMessage', () => {
  it('matches Anthropic-style catalog 404s', () => {
    expect(isMissingModelCatalogMessage('Model discovery failed (HTTP 404)')).toBe(true)
  })
})
