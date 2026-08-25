import { describe, expect, it } from 'vitest'
import { apiKeyKindsForPlatform, rendererPlatformHint } from './provider-credentials'

describe('provider credential platform options', () => {
  it('offers macOS Keychain only on macOS', () => {
    expect(apiKeyKindsForPlatform('darwin')).toContain('keychain')
    expect(apiKeyKindsForPlatform('win32')).not.toContain('keychain')
    expect(apiKeyKindsForPlatform('linux')).not.toContain('keychain')
  })

  it('maps renderer platform hints to Node platform names', () => {
    expect(rendererPlatformHint('MacIntel')).toBe('darwin')
    expect(rendererPlatformHint('Win32')).toBe('win32')
    expect(rendererPlatformHint('Linux x86_64')).toBe('linux')
    expect(rendererPlatformHint(undefined)).toBe('')
  })
})
