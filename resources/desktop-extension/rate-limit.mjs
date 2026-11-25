const OPENAI_RATE_LIMIT = /rate_limit_exceeded|\brate limit (?:reached|exceeded)\b/i
const OPENAI_BILLING_ADVICE =
  /\s*You can increase your rate limit by adding a payment method to your account at https:\/\/platform\.openai\.com\/account\/billing\.?/i

export function installRateLimitHandling(pi) {
  pi.on('message_end', ({ message }) => {
    if (message.role !== 'assistant' || message.stopReason !== 'error') return
    const error = message.errorMessage
    if (!error || !OPENAI_RATE_LIMIT.test(error)) return

    // Pi treats billing errors as terminal. Drop the optional OpenAI rate-limit
    // advice before Pi evaluates the error, preserving the limit and retry hint.
    const errorMessage = error.replace(OPENAI_BILLING_ADVICE, '')
    if (errorMessage !== error) return { message: { ...message, errorMessage } }
  })
}
