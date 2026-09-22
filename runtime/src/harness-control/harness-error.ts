/**
 * Runtime-local Harness error.
 *
 * Mirrors `src/main/harness/harness-error.ts`, layered on the runtime's
 * `RuntimeError` RPC error taxonomy (codes extended in Phase 3 to cover the
 * Harness control plane). Harness errors are recoverable by default — the UI
 * can react (retry, pick another run, resume a checkpoint...).
 */

import { RuntimeError } from '../pi/errors.js'
import type { HarnessErrorCode } from './types.js'

export class HarnessError extends RuntimeError {
  readonly details?: unknown

  constructor(code: HarnessErrorCode, message: string, details?: unknown, userMessage?: string) {
    super(code, message, {
      recoverable: true,
      ...(userMessage !== undefined ? { userMessage } : {})
    })
    this.name = 'HarnessError'
    this.details = details
  }
}
