import type { HarnessErrorCode } from '@shared/types/harness'
import { AppError } from '../services/errors'

export class HarnessError extends AppError {
  constructor(code: HarnessErrorCode, message: string, details?: unknown, userMessage = message) {
    super(code, message, details, undefined, { userMessage, recoverable: true })
  }
}
