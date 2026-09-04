import { describe, it, expect } from 'vitest'
import {
  skillFormSchema,
  skillImportSchema,
  providerFormSchema,
  providerModelDiscoverySchema
} from '@shared/schemas/domain'

describe('skillFormSchema', () => {
  it('accepts a valid skill', () => {
    const r = skillFormSchema.safeParse({
      name: 'my-skill',
      description: 'Does a thing',
      content: '# Overview\n\nHello world skill body.\n',
      targetRoot: '/Users/me/.pi/agent/skills'
    })
    expect(r.success).toBe(true)
  })

  it('rejects path traversal in name', () => {
    const r = skillFormSchema.safeParse({
      name: '../escape',
      description: '',
      content: '# enough content here',
      targetRoot: '/tmp/skills'
    })
    expect(r.success).toBe(false)
  })

  it('rejects uppercase names', () => {
    const r = skillFormSchema.safeParse({
      name: 'BadName',
      description: '',
      content: '# enough content here',
      targetRoot: '/tmp/skills'
    })
    expect(r.success).toBe(false)
  })
})

describe('skillImportSchema', () => {
  it('accepts optional onConflict', () => {
    const r = skillImportSchema.safeParse({
      source: '/tmp/src',
      targetRoot: '/tmp/dst',
      name: 'imported',
      onConflict: 'rename'
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.onConflict).toBe('rename')
  })
})

describe('providerFormSchema', () => {
  it('requires key slug', () => {
    const r = providerFormSchema.safeParse({
      key: '',
      name: 'x',
      displayName: 'x',
      enabled: true,
      protocol: 'openai-completions',
      baseUrl: 'https://api.example.com',
      apiKey: null,
      headers: {},
      authHeader: true,
      timeout: null
    })
    expect(r.success).toBe(false)
  })

  it('accepts timeout and headers', () => {
    const r = providerFormSchema.safeParse({
      key: 'acme',
      name: 'Acme',
      displayName: 'Acme',
      enabled: true,
      protocol: 'openai-completions',
      baseUrl: 'https://api.example.com/v1',
      apiKey: { kind: 'env', envRef: '$ACME_KEY' },
      headers: { 'X-Org': '1' },
      authHeader: true,
      timeout: 10_000
    })
    expect(r.success).toBe(true)
  })

  it('accepts mixed-case keys and opaque api secrets', () => {
    const r = providerFormSchema.safeParse({
      key: 'NVIDIA-NIM',
      name: 'NVIDIA',
      displayName: 'NVIDIA NIM',
      enabled: true,
      protocol: 'openai-completions',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: { kind: 'literal', literal: 'nvapi-4SasPSHM0Ilo' },
      headers: {},
      authHeader: true,
      timeout: null
    })
    expect(r.success).toBe(true)
  })

  it('accepts catalog metadata for the auto-created default model', () => {
    const r = providerFormSchema.safeParse({
      key: 'deepseek',
      name: 'DeepSeek',
      displayName: 'DeepSeek',
      enabled: true,
      protocol: 'openai-completions',
      baseUrl: 'https://api.deepseek.com',
      apiKey: { kind: 'literal', literal: 'sk-secret' },
      headers: {},
      authHeader: true,
      timeout: null,
      defaultModelId: 'deepseek-v4-flash',
      defaultModel: {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        contextWindow: 1_000_000,
        maxOutputTokens: 384_000
      }
    })
    expect(r.success).toBe(true)
  })

  it('accepts discovered models for atomic import on provider save', () => {
    const r = providerFormSchema.safeParse({
      key: 'acme',
      name: 'acme',
      displayName: 'Acme',
      enabled: true,
      protocol: 'openai-completions',
      baseUrl: 'https://api.acme.test/v1',
      apiKey: null,
      headers: {},
      authHeader: true,
      timeout: null,
      discoveredModels: [
        { id: 'acme-chat', name: 'Acme Chat', input: ['text', 'image'] },
        { id: 'acme-reasoning', name: 'Acme Reasoning' }
      ]
    })
    expect(r.success).toBe(true)
  })
})

describe('providerModelDiscoverySchema', () => {
  it('accepts only bounded draft connection fields', () => {
    expect(
      providerModelDiscoverySchema.safeParse({
        existingProviderKey: null,
        protocol: 'openai-completions',
        baseUrl: 'https://api.acme.test/v1',
        apiKey: { kind: 'literal', literal: 'secret' },
        headers: { 'X-Org': '1' },
        authHeader: true,
        timeout: 15_000
      }).success
    ).toBe(true)
    expect(
      providerModelDiscoverySchema.safeParse({
        protocol: 'openai-completions',
        baseUrl: 'https://api.acme.test/v1',
        apiKey: null,
        headers: {},
        authHeader: true,
        timeout: null,
        arbitraryCommand: '!dangerous'
      }).success
    ).toBe(false)
  })
})
