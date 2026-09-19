import { describe, expect, it } from 'vitest'
import { inspectRuntimeError, sanitizeRuntimeErrorMessage } from './runtime-error'

const QUOTA =
  'Summarization failed: 429 {"error":{"code":"AccountQuotaExceeded","message":"You have exceeded the 5-hour usage quota. It will reset at 2026-09-19 11:23:11 +0800 CST. We recommend upgrading your plan for more quota, or waiting for the reset. Request id: abc","param":"","type":"TooManyRequests"}}'

describe('inspectRuntimeError', () => {
  it('turns a compact/summarization quota dump into a recoverable hint', () => {
    const info = inspectRuntimeError(QUOTA)
    expect(info.kind).toBe('quota')
    expect(info.resetAt).toBe('2026-09-19 11:23:11 +0800 CST')
    expect(info.userMessage).toBe(
      "This model's quota is exhausted until 2026-09-19 11:23:11 +0800 CST. Switch to another model and retry."
    )
    expect(info.userMessage).not.toMatch(/[{}]/)
  })

  it('strips braces from generic provider payloads so i18n cannot interpolate them', () => {
    expect(sanitizeRuntimeErrorMessage('boom {code} {message}')).toBe('boom (code) (message)')
  })
})
