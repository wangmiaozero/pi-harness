export class UpstreamError extends Error {
  constructor(
    message: string,
    code: string,
    details?: { status?: number; providerRetryAfterMs?: number }
  )
  code: string
  status?: number
  providerRetryAfterMs?: number
  unavailable?: boolean
}
