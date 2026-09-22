/**
 * Secret redaction for runtime logs and export payloads.
 *
 * Mirrors the Electron main-process redactor so export / debug bundles never
 * ship API keys, tokens or credentials.
 */

const SECRET_KEY_RE =
  /(api[-_]?key|authorization|^auth$|token|secret|password|cookie|bearer|apikey)/i
const MASK = '••••••••••'

export function redactSecretText(value: string): string {
  return value
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${MASK}`)
    .replace(/([?&](?:key|api[-_]?key|access[-_]?token|token)=)[^&#\s]+/gi, `$1${MASK}`)
    .replace(/(\s-w\s+)(?:"[^"]*"|'[^']*'|\S+)/g, `$1${MASK}`)
    .replace(/\b((?:sk|rk|pk)-)[A-Za-z0-9_-]{8,}\b/g, `$1${MASK}`)
    .replace(
      /((?:api[-_]?key|authorization|token|secret|password|cookie)\s*[:=]\s*["']?)[^"',;\s}]+/gi,
      `$1${MASK}`
    )
}

export function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value
  if (typeof value === 'string') return redactSecretText(value)
  if (typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (value instanceof Error) {
    const error = value as NodeJS.ErrnoException & { signal?: unknown }
    return {
      name: error.name,
      message: redactSecretText(error.message),
      ...(error.code ? { code: error.code } : {}),
      ...(error.signal ? { signal: error.signal } : {}),
      ...(error.stack ? { stack: redactSecretText(error.stack) } : {})
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, seen))
  }

  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_RE.test(key) ? MASK : redactSecrets(nested, seen)
  }
  return out
}
