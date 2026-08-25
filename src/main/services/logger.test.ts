import { describe, expect, it } from 'vitest'
import { redactSecrets, redactSecretText } from './logger'

describe('logger secret redaction', () => {
  it('redacts credentials embedded in strings and URLs', () => {
    const input = 'POST https://example.test/models/x?key=AIza-secret Bearer sk-live-secretvalue'
    const output = redactSecretText(input)

    expect(output).not.toContain('AIza-secret')
    expect(output).not.toContain('sk-live-secretvalue')
    expect(output).toContain('?key=••••••••••')
  })

  it('does not expose child-process command arguments from Error objects', () => {
    const error = Object.assign(
      new Error('Command failed: security add-generic-password -w plaintext-secret'),
      {
        code: 1,
        cmd: 'security add-generic-password -w plaintext-secret'
      }
    )

    const output = redactSecrets(error) as Record<string, unknown>
    expect(JSON.stringify(output)).not.toContain('plaintext-secret')
    expect(output).not.toHaveProperty('cmd')
    expect(output).toMatchObject({ name: 'Error', code: 1 })
  })

  it('redacts nested values by secret-shaped keys', () => {
    expect(redactSecrets({ headers: { Authorization: 'Bearer secret' } })).toEqual({
      headers: { Authorization: '••••••••••' }
    })
  })

  it('does not leak the original object through circular references', () => {
    const input: Record<string, unknown> = { token: 'plain-secret' }
    input.self = input

    const output = redactSecrets(input)

    expect(output).toEqual({ token: '••••••••••', self: '[Circular]' })
    expect(JSON.stringify(output)).not.toContain('plain-secret')
  })
})
