import { describe, expect, it } from 'vitest'
import { providerIdentityUrlReady, suggestProviderIdentity } from './provider-identity'

describe('suggestProviderIdentity', () => {
  it.each([
    ['https://integrate.api.nvidia.com/v1', 'nvidia', 'NVIDIA'],
    ['https://api.openai.com/v1', 'openai', 'OpenAI'],
    ['https://api.deepseek.com', 'deepseek', 'DeepSeek'],
    ['https://generativelanguage.googleapis.com/v1beta', 'google', 'Google'],
    ['https://api.example.co.uk/v1', 'example', 'Example'],
    ['http://localhost:1234/v1', 'localhost-1234', 'Localhost 1234']
  ])('derives identity from %s', (url, key, displayName) => {
    expect(suggestProviderIdentity(url)).toEqual({
      key,
      displayName,
      internalName: key
    })
  })

  it('rejects invalid and non-http URLs', () => {
    expect(suggestProviderIdentity('not-a-url')).toBeNull()
    expect(suggestProviderIdentity('file:///tmp/models')).toBeNull()
  })

  it('waits until the host is complete before an automatic identity', () => {
    expect(providerIdentityUrlReady('https://api.d')).toBe(false)
    expect(providerIdentityUrlReady('https://api.deepseek.c')).toBe(false)
    expect(providerIdentityUrlReady('https://api.deepseek.com')).toBe(true)
    expect(providerIdentityUrlReady('http://127.0.0.1:11434/v1')).toBe(true)
    expect(providerIdentityUrlReady('http://localhost:11434/v1')).toBe(true)
  })
})
