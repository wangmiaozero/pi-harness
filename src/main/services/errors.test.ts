import { describe, expect, it } from 'vitest'
import { AppError, toErrorPayload } from './errors'

describe('IPC error payload redaction', () => {
  it('redacts secrets from generic error messages', () => {
    const payload = toErrorPayload(new Error('request failed: Bearer sk-live-secretvalue'))

    expect(payload.message).not.toContain('sk-live-secretvalue')
    expect(payload.message).toContain('Bearer ••••••••••')
  })

  it('redacts secret-shaped application error details and nested causes', () => {
    const cause = new AppError('APP_ERROR', 'token=plain-secret')
    const error = new AppError(
      'APP_ERROR',
      'provider failed',
      { authorization: 'Bearer plain-secret' },
      cause
    )

    expect(toErrorPayload(error)).toEqual({
      code: 'APP_ERROR',
      message: 'provider failed',
      details: { authorization: '••••••••••' },
      cause: {
        code: 'APP_ERROR',
        message: 'token=••••••••••',
        details: undefined
      }
    })
  })
})
