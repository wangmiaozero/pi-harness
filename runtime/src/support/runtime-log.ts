/**
 * Lightweight logger adapter for ported Electron harness modules.
 *
 * Electron uses `log.harness.warn(...)`. The sidecar has no consola; every
 * diagnostic goes to stderr via the JSONL transport.
 */

import { logDiagnostic } from '../transport/jsonl.js'
import { redactSecrets } from './secrets.js'

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      const redacted = redactSecrets(arg)
      if (typeof redacted === 'string') return redacted
      if (redacted instanceof Error) return redacted.message
      try {
        return JSON.stringify(redacted)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

function scoped(tag: string) {
  const write = (level: string, args: unknown[]) => {
    logDiagnostic(`[${tag}] ${level}: ${formatArgs(args)}`)
  }
  return {
    debug: (...args: unknown[]) => write('debug', args),
    info: (...args: unknown[]) => write('info', args),
    warn: (...args: unknown[]) => write('warn', args),
    error: (...args: unknown[]) => write('error', args)
  }
}

export const log = {
  harness: scoped('Harness'),
  agent: scoped('Agent')
}

export { redactSecretText, redactSecrets } from './secrets.js'
