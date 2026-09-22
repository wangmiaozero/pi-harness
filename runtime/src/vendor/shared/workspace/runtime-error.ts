// @ts-nocheck
export type RuntimeErrorKind = 'quota' | 'provider' | 'generic'

export interface RuntimeErrorInfo {
  kind: RuntimeErrorKind
  resetAt?: string
  userMessage: string
}

const PROVIDER_STATUS_JSON = /(\d{3})\s+(\{[\s\S]*\})/
const SUMMARIZATION_PREFIX = /^Summarization failed:\s*/i

export function inspectRuntimeError(raw: unknown): RuntimeErrorInfo {
  const text = extractErrorText(raw)
  const stripped = text.replace(SUMMARIZATION_PREFIX, '').trim()
  const match = stripped.match(PROVIDER_STATUS_JSON)
  if (match) {
    const status = Number(match[1])
    let parsed: { error?: { code?: string; message?: string; type?: string } }
    try {
      parsed = JSON.parse(match[2]) as { error?: { code?: string; message?: string; type?: string } }
    } catch {
      return { kind: 'generic', userMessage: withoutTemplateBraces(stripped) }
    }
    const code = parsed.error?.code ?? ''
    const message = parsed.error?.message ?? ''
    const combined = `${code} ${message}`
    const quota =
      status === 429 ||
      code === 'AccountQuotaExceeded' ||
      /quota|TooManyRequests|rate.?limit/i.test(combined)
    if (quota) {
      const resetAt = message.match(/reset at\s+(.+?)(?:\.|$)/i)?.[1]?.trim()
      return {
        kind: 'quota',
        ...(resetAt ? { resetAt } : {}),
        userMessage: resetAt
          ? `This model's quota is exhausted until ${resetAt}. Switch to another model and retry.`
          : "This model's quota is exhausted. Switch to another model and retry."
      }
    }
    if (/thinking\.type disabled is not supported/i.test(message)) {
      return {
        kind: 'provider',
        userMessage: 'This model cannot disable thinking. Switch to another model and retry.'
      }
    }
    return { kind: 'provider', userMessage: withoutTemplateBraces(message || stripped) }
  }
  if (/AccountQuotaExceeded|usage quota|5-hour usage quota/i.test(text)) {
    const resetAt = text.match(/reset at\s+(.+?)(?:\.|$)/i)?.[1]?.trim()
    return {
      kind: 'quota',
      ...(resetAt ? { resetAt } : {}),
      userMessage: resetAt
        ? `This model's quota is exhausted until ${resetAt}. Switch to another model and retry.`
        : "This model's quota is exhausted. Switch to another model and retry."
    }
  }
  return { kind: 'generic', userMessage: withoutTemplateBraces(text) }
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
