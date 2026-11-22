import { describe, expect, it } from 'vitest'
import {
  inspectRuntimeError,
  parseRetryAfterMs,
  runtimeEventError,
  sanitizeRuntimeErrorMessage
} from './runtime-error'

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

  const TPM =
    '429 Rate limit reached for gpt-6.2-sol in organization org-fixture on tokens per min (TPM): Limit 500000, Used 480210, Requested 61204. Please try again in 4.85s. Visit https://platform.openai.com/account/rate-limits to learn more.'

  it.each([
    ['plain provider text', TPM],
    [
      'a JSON provider payload',
      `429 ${JSON.stringify({ error: { message: TPM.slice(4), type: 'tokens', code: 'rate_limit_exceeded' } })}`
    ],
    ['a failed summary', `Summarization failed: ${TPM}`],
    ['a failed compaction', `Compaction failed: ${TPM}`]
  ])('treats TPM throttling in %s as a transient rate limit, not overflow or quota', (_, raw) => {
    const info = inspectRuntimeError(raw)
    expect(info).toMatchObject({ kind: 'rate_limit', rateLimitScope: 'tokens', retryAfterMs: 4850 })
    expect(info.userMessage).toContain('tokens per minute')
    expect(info.userMessage).not.toMatch(/quota|switch/i)
    // Pi-Harness stores the user message; inspecting it again keeps the classification.
    expect(inspectRuntimeError(info.userMessage)).toMatchObject({
      kind: 'rate_limit',
      rateLimitScope: 'tokens',
      retryAfterMs: 5000
    })
  })

  it('classifies request throttles and Azure token throttles with their retry hints', () => {
    expect(
      inspectRuntimeError('Rate limit reached on requests per min (RPM). Please try again in 1m30s.')
    ).toMatchObject({ kind: 'rate_limit', rateLimitScope: 'requests', retryAfterMs: 90_000 })
    expect(
      inspectRuntimeError(
        '429 Requests to the ChatCompletions_Create Operation have exceeded token rate limit of your current pricing tier. Please retry after 20 seconds.'
      )
    ).toMatchObject({ kind: 'rate_limit', rateLimitScope: 'tokens', retryAfterMs: 20_000 })
    expect(inspectRuntimeError('429 Too Many Requests')).toMatchObject({ kind: 'rate_limit' })
    expect(inspectRuntimeError('429 Too Many Requests').retryAfterMs).toBeUndefined()
  })

  it('keeps billing exhaustion as quota even when sent with HTTP 429', () => {
    expect(
      inspectRuntimeError(
        '429 {"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}'
      ).kind
    ).toBe('quota')
  })

  it('treats a stopped local model as an abort, not a failed reply', () => {
    expect(inspectRuntimeError('Request aborted').kind).toBe('aborted')
    expect(inspectRuntimeError('Request timed out.: The operation was aborted. (20)').kind).toBe(
      'aborted'
    )
    expect(
      runtimeEventError({
        type: 'message_end',
        message: { role: 'assistant', errorMessage: 'Request aborted' }
      })
    ).toBeNull()
    expect(inspectRuntimeError('Request timed out').kind).toBe('generic')
  })

  it('separates context overflow and summary output caps from throttling', () => {
    expect(
      inspectRuntimeError(
        '400 {"error":{"message":"This model\'s maximum context length is 128000 tokens. However, your messages resulted in 131261 tokens.","code":"context_length_exceeded"}}'
      ).kind
    ).toBe('context_overflow')
    expect(
      inspectRuntimeError(
        'Compaction failed: Summarization failed: generation hit the token cap and the summary is incomplete'
      ).kind
    ).toBe('output_limit')
  })
})

describe('parseRetryAfterMs', () => {
  it.each([
    ['Please try again in 20ms.', 20],
    ['Please try again in 6m0s.', 360_000],
    ['retry after 2 minutes', 120_000],
    ['Retry in about 5s.', 5000],
    ['no hint here', undefined]
  ])('%s', (text, expected) => {
    expect(parseRetryAfterMs(text)).toBe(expected)
  })
})

describe('runtimeEventError', () => {
  it('recognizes a thinking-only length stop even without a provider error', () => {
    const error = runtimeEventError({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'length',
        content: [{ type: 'thinking', thinking: 'Let' }],
        usage: { input: 131_261, output: 1 }
      }
    })
    expect(error).toContain('Compact this conversation')
    expect(inspectRuntimeError(error).kind).toBe('truncated')
  })

  it('clears a pending error only on a new assistant completion', () => {
    expect(
      runtimeEventError({ type: 'message_end', message: { role: 'toolResult' } })
    ).toBeUndefined()
    expect(runtimeEventError({ type: 'message_end', message: { role: 'user' } })).toBeUndefined()
    expect(
      runtimeEventError({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } })
    ).toBeNull()
    expect(
      runtimeEventError({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'aborted' }
      })
    ).toBeNull()
  })

  it.each(['compaction_end', 'auto_compaction_end'])('surfaces failed %s recovery', (type) => {
    expect(runtimeEventError({ type, errorMessage: QUOTA })).toContain('quota is exhausted')
    expect(runtimeEventError({ type, aborted: true, errorMessage: 'cancelled' })).toBeUndefined()
    expect(runtimeEventError({ type })).toBeUndefined()
  })
})
