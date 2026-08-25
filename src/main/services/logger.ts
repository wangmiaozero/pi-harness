/**
 * Main-process logger with automatic secret redaction.
 *
 * Every log call runs through a redactor that masks the values of any key
 * matching the secret-denylist (apiKey, authorization, token, secret,
 * password, cookie, bearer). Raw secrets are never written to logs.
 */

import { createConsola } from 'consola'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const SECRET_KEY_RE =
  /(api[-_]?key|authorization|^auth$|token|secret|password|cookie|bearer|apikey)/i
const MASK = '••••••••••'

/** Redact common secret encodings that can appear inside free-form messages and Error stacks. */
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

/** Redact secret-shaped keys anywhere in a log argument (objects/arrays/strings). */
export function redactSecrets(value: unknown, seen = new WeakSet()): unknown {
  if (value == null) return value
  if (typeof value === 'string') return redactSecretText(value)
  if (typeof value !== 'object') return value
  // Never hand the original object back to the logger. A circular reference
  // can otherwise re-introduce secret-shaped fields after its first redaction.
  if (seen.has(value as object)) return '[Circular]'
  seen.add(value as object)

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
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_RE.test(k) ? MASK : redactSecrets(v, seen)
  }
  return out
}

class Logger {
  private consola = createConsola({ level: 4 })

  private scope(name: string) {
    return this.consola.withTag(name)
  }

  for(name: string) {
    const scoped = this.scope(name)
    const wrap = (level: 'debug' | 'info' | 'warn' | 'error') => {
      return (...args: unknown[]) => {
        const redacted = args.map((a) => redactSecrets(a))
        // consola overloads reject a free spread; call with known arity.
        if (redacted.length === 0) scoped[level]('')
        else if (redacted.length === 1) scoped[level](redacted[0])
        else scoped[level](redacted[0], ...redacted.slice(1))
      }
    }
    return {
      debug: wrap('debug'),
      info: wrap('info'),
      warn: wrap('warn'),
      error: wrap('error')
    }
  }
}

export const logger = new Logger()

/** Sub-loggers for each documented subsystem. */
export const log = {
  app: logger.for('app'),
  pi: logger.for('pi'),
  config: logger.for('config'),
  provider: logger.for('provider'),
  skills: logger.for('skills'),
  backup: logger.for('backup'),
  ipc: logger.for('ipc'),
  updater: logger.for('updater'),
  security: logger.for('security'),
  agent: logger.for('agent'),
  session: logger.for('session'),
  git: logger.for('git')
}
