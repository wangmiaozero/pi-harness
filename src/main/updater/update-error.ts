import { AppError } from '../services/errors'
export class UpdateError extends AppError {
  constructor(
    readonly reason: string,
    message: string,
    retryable = false
  ) {
    super(
      reason.startsWith('NETWORK') || reason === 'DOWNLOAD_CANCELLED'
        ? 'NETWORK_ERROR'
        : 'SECURITY_ERROR',
      message,
      { reason },
      undefined,
      { recoverable: retryable }
    )
  }
}
export function updateFailure(error: unknown) {
  if (error instanceof UpdateError)
    return { code: error.reason, message: error.message, retryable: error.recoverable }
  return {
    code: 'UPDATE_FAILED',
    message: 'The update could not be completed. Retry or use the official release page.',
    retryable: true
  }
}
