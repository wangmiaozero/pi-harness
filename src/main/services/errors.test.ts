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
      userMessage: 'provider failed',
      recoverable: false,
      context: { authorization: '••••••••••' },
      details: { authorization: '••••••••••' },
      cause: {
        code: 'APP_ERROR',
        message: 'token=••••••••••',
        userMessage: 'token=••••••••••',
        recoverable: false,
        context: undefined,
        details: undefined
      }
    })
  })

  it('maps provider quota dumps to a recoverable agent error', () => {
    const payload = toErrorPayload(
      new Error(
        'Summarization failed: 429 {"error":{"code":"AccountQuotaExceeded","message":"You have exceeded the 5-hour usage quota. It will reset at 2026-09-19 11:23:11 +0800 CST.","type":"TooManyRequests"}}'
      )
    )
    expect(payload).toMatchObject({
      code: 'AGENT_ERROR',
      recoverable: true
    })
    expect(payload.userMessage).toContain('quota is exhausted')
    expect(payload.userMessage).not.toMatch(/[{}]/)
  })

  it('marks conflicts as recoverable while preserving the legacy details field', () => {
    const error = new AppError('CONFIG_CONFLICT', 'Configuration changed', { file: 'models' })

    expect(toErrorPayload(error)).toMatchObject({
      code: 'CONFIG_CONFLICT',
      recoverable: true,
      userMessage: 'Configuration changed',
      context: { file: 'models' },
      details: { file: 'models' }
    })
  })
})
