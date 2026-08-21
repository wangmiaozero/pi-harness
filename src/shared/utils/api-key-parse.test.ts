/**
 * Pure api-key parsing helpers mirrored from adapter for unit tests.
 * The real adapter lives in main and pulls Electron; these cover the
 * wire-format rules without importing secret-store.
 */

import { describe, it, expect } from 'vitest'
import type { ApiKeySpec } from '@shared/types/domain'

function parseApiKeyFromPi(raw: string | undefined): {
  apiKey: ApiKeySpec | null
  apiKeyRef: string | null
} {
  if (!raw) return { apiKey: null, apiKeyRef: null }
  if (raw.startsWith('!')) {
    const m = raw.match(/-s\s+"pi-harness-([^"]+)"/)
    if (m?.[1]) {
      return {
        apiKey: { kind: 'stored', command: raw },
        apiKeyRef: m[1]
      }
    }
    return { apiKey: { kind: 'command', command: raw }, apiKeyRef: null }
  }
  if (raw.startsWith('$') || raw.startsWith('${')) {
    return { apiKey: { kind: 'env', envRef: raw }, apiKeyRef: null }
  }
  return { apiKey: { kind: 'literal' }, apiKeyRef: null }
}

describe('parseApiKeyFromPi (wire rules)', () => {
  it('parses env refs', () => {
    expect(parseApiKeyFromPi('$OPENAI_API_KEY')).toEqual({
      apiKey: { kind: 'env', envRef: '$OPENAI_API_KEY' },
      apiKeyRef: null
    })
  })

  it('parses pi-harness keychain commands', () => {
    const cmd = '!security find-generic-password -a "$USER" -s "pi-harness-abc123" -w'
    const r = parseApiKeyFromPi(cmd)
    expect(r.apiKeyRef).toBe('abc123')
    expect(r.apiKey?.kind).toBe('stored')
  })

  it('never exposes plaintext literals', () => {
    const r = parseApiKeyFromPi('sk-live-secret')
    expect(r.apiKey).toEqual({ kind: 'literal' })
    expect(r.apiKeyRef).toBeNull()
  })

  it('handles empty', () => {
    expect(parseApiKeyFromPi(undefined)).toEqual({ apiKey: null, apiKeyRef: null })
  })
})
