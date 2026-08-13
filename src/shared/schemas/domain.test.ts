import { describe, it, expect } from 'vitest'
import { skillFormSchema, skillImportSchema, providerFormSchema } from '@shared/schemas/domain'

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
})
