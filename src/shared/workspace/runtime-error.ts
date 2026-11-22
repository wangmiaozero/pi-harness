/**
 * `quota` is a hard account/billing limit (insufficient_quota); `rate_limit` is a
 * transient per-minute throttle (TPM/RPM) that resolves by waiting.
 */
export type RuntimeErrorKind =
  | 'quota'
  | 'rate_limit'
  | 'context_overflow'
  | 'output_limit'
  | 'provider'
  | 'truncated'
  | 'aborted'
  | 'generic'

const TRUNCATED_REPLY_ERROR =
  'The reply was cut short by the model context or output limit. Compact this conversation or switch to a model with a larger context, then retry.'

/**
 * A pending outcome, reported only after Native Pi settles its recovery attempts.
 * Undefined leaves the previous outcome intact (e.g. a tool result after an error).
 */
export function runtimeEventError(event: {
  type: string
  message?: unknown
  errorMessage?: unknown
  aborted?: unknown
}): string | null | undefined {
  if (event.type === 'message_end') {
    const message = event.message as
      { role?: unknown; stopReason?: unknown; errorMessage?: unknown } | undefined
    if (message?.role !== 'assistant') return undefined
    if (typeof message.errorMessage === 'string' && message.errorMessage.trim()) {
      const info = inspectRuntimeError(message.errorMessage)
      if (info.kind === 'aborted') return null
      return info.userMessage
    }
    if (message.stopReason === 'error') return 'Agent error'
    if (message.stopReason === 'length') return TRUNCATED_REPLY_ERROR
    return null
  }
  if (
    (event.type === 'compaction_end' || event.type === 'auto_compaction_end') &&
    event.aborted !== true &&
    typeof event.errorMessage === 'string' &&
    event.errorMessage.trim()
  ) {
    return inspectRuntimeError(event.errorMessage).userMessage
  }
  return undefined
}

export interface RuntimeErrorInfo {
  kind: RuntimeErrorKind
  resetAt?: string
  /** Provider-suggested wait before retrying a rate-limited request. */
  retryAfterMs?: number
  rateLimitScope?: 'tokens' | 'requests'
  userMessage: string
}

const PROVIDER_STATUS_JSON = /(\d{3})\s+(\{[\s\S]*\})/
const SUMMARIZATION_PREFIX = /^(?:Summarization failed|(?:Auto-)?[Cc]ompaction failed):\s*/i

const HARD_QUOTA =
  /insufficient_quota|exceeded your current quota|AccountQuotaExceeded|usage quota|billing|out of budget|available balance|GoUsageLimitError|FreeUsageLimitError|Monthly usage limit|subscription_sharing_(?:workplace_individual_)?usage_limit_exceeded|"code"\s*:\s*"?1308(?!\d)/i
const RATE_LIMIT =
  /rate.?limit|too many requests|tokens per min|requests per min|\b[TR]PM\b|TooManyRequests|throttl|ResourceExhausted|RESOURCE_EXHAUSTED/i
const CONTEXT_OVERFLOW =
  /context_length_exceeded|maximum context length|context (?:length|window) (?:is )?exceeded|exceeds? the (?:model'?s? )?(?:context|maximum (?:context|input))|prompt is too long|input is too long|reduce the length of the (?:messages|prompt)|request too large for model/i
const OUTPUT_LIMIT =
  /token cap and the summary is incomplete|max_output_tokens|maximum output tokens|output token limit/i
/** A stop or a local runner reporting that the caller went away. Not a failed reply. */
const ABORTED =
  /^(?:request aborted|aborted by (?:the )?user|operation (?:was )?aborted)\b|the operation was aborted|request timed out\.?:?\s*the operation was aborted|\brequest was aborted\b/i

export function inspectRuntimeError(raw: unknown): RuntimeErrorInfo {
  const text = extractErrorText(raw)
  if (ABORTED.test(text)) return { kind: 'aborted', userMessage: text }
  if (text === TRUNCATED_REPLY_ERROR) return { kind: 'truncated', userMessage: text }
  const stripped = text.replace(SUMMARIZATION_PREFIX, '').trim()
  const match = stripped.match(PROVIDER_STATUS_JSON)
  let status = Number(stripped.match(/^(\d{3})\b/)?.[1] ?? 0)
  let providerMessage = stripped
  let combined = stripped
  if (match) {
    status = Number(match[1])
    let parsed: { error?: { code?: unknown; message?: unknown; type?: unknown } }
    try {
      parsed = JSON.parse(match[2]) as typeof parsed
    } catch {
      return { kind: 'generic', userMessage: withoutTemplateBraces(stripped) }
    }
    const code = typeof parsed.error?.code === 'string' ? parsed.error.code : ''
    const type = typeof parsed.error?.type === 'string' ? parsed.error.type : ''
    providerMessage = typeof parsed.error?.message === 'string' ? parsed.error.message : ''
    combined = `${code} ${type} ${providerMessage}`
  }
  const retryAfterMs = parseRetryAfterMs(combined)
  if (HARD_QUOTA.test(combined)) return quotaError(combined)
  if (status === 429 || RATE_LIMIT.test(combined) || (/quota/i.test(combined) && retryAfterMs)) {
    const scope = /tokens? per min|\bTPM\b|token rate limit|input_token/i.test(combined)
      ? 'tokens'
      : /requests? per min|\bRPM\b/i.test(combined)
        ? 'requests'
        : undefined
    const wait = retryAfterMs ? ` Retry in about ${Math.ceil(retryAfterMs / 1000)}s.` : ''
    return {
      kind: 'rate_limit',
      ...(retryAfterMs ? { retryAfterMs } : {}),
      ...(scope ? { rateLimitScope: scope } : {}),
      userMessage: `The provider rate limit was reached${scope === 'tokens' ? ' (tokens per minute)' : scope === 'requests' ? ' (requests per minute)' : ''}. The conversation is intact.${wait}`
    }
  }
  if (/quota/i.test(combined)) return quotaError(combined)
  if (CONTEXT_OVERFLOW.test(combined)) {
    return {
      kind: 'context_overflow',
      userMessage:
        'The conversation exceeds the model context window. Compact this conversation or switch to a model with a larger context, then retry.'
    }
  }
  if (OUTPUT_LIMIT.test(combined)) {
    return { kind: 'output_limit', userMessage: withoutTemplateBraces(providerMessage || stripped) }
  }
  if (match) {
    if (/thinking\.type disabled is not supported/i.test(providerMessage)) {
      return {
        kind: 'provider',
        userMessage: 'This model cannot disable thinking. Switch to another model and retry.'
      }
    }
    return { kind: 'provider', userMessage: withoutTemplateBraces(providerMessage || stripped) }
  }
  return { kind: 'generic', userMessage: withoutTemplateBraces(text) }
}

function quotaError(text: string): RuntimeErrorInfo {
  const resetAt = text.match(/reset at\s+(.+?)(?:\.|$)/i)?.[1]?.trim()
  return {
    kind: 'quota',
    ...(resetAt ? { resetAt } : {}),
    userMessage: resetAt
      ? `This model's quota is exhausted until ${resetAt}. Switch to another model and retry.`
      : "This model's quota is exhausted. Switch to another model and retry."
  }
}

const DURATION_UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }

/** Reads provider hints such as "try again in 1m30.5s" or "retry after 20 seconds". */
export function parseRetryAfterMs(text: string): number | undefined {
  const hint = text.match(
    /(?:try again|retry(?: your request)?)\s+(?:in|after)\s+(?:about\s+)?((?:\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hours?)\s*)+)/i
  )?.[1]
  if (!hint) return undefined
  let total = 0
  for (const [, value, unit] of hint.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gi)) {
    const key = unit.toLowerCase()
    const scale = key.startsWith('ms') || key.startsWith('milli') ? 'ms' : key[0]
    total += Number(value) * (DURATION_UNITS[scale] ?? 0)
  }
  return total > 0 ? Math.ceil(total) : undefined
}

export function sanitizeRuntimeErrorMessage(raw: unknown): string {
  return inspectRuntimeError(raw).userMessage
}

function extractErrorText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw instanceof Error) return raw.message
  if (raw && typeof raw === 'object') {
    const record = raw as { message?: unknown; userMessage?: unknown; error?: unknown }
    if (typeof record.userMessage === 'string' && record.userMessage.trim()) {
      return record.userMessage
    }
    if (typeof record.message === 'string' && record.message.trim()) return record.message
    if (record.error != null) return extractErrorText(record.error)
  }
  return raw == null ? 'Unknown error' : String(raw)
}

/** Prevent vue-i18n / message compilers from treating provider JSON as `{named}` templates. */
function withoutTemplateBraces(value: string): string {
  return value.replace(/\{/g, '(').replace(/\}/g, ')')
}
