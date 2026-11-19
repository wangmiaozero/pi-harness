import type {
  ConnectionTestStatus,
  ProviderUpstreamDiagnostic
} from '@shared/providers/connection-diagnostics'
import { ProviderTransportError } from './provider-network'
import { ResponsesWebSocketError } from './responses-websocket'
import { ResponseSizeError } from './bounded-json'

const codesByStatus = {
  dns_error: ['ENOTFOUND', 'EAI_AGAIN', 'ERR_NAME_NOT_RESOLVED', 'ERR_NAME_RESOLUTION_FAILED'],
  connection_refused: ['ECONNREFUSED', 'ERR_CONNECTION_REFUSED'],
  network_unreachable: [
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ERR_ADDRESS_UNREACHABLE',
    'ERR_INTERNET_DISCONNECTED'
  ],
  connection_timeout: ['UND_ERR_CONNECT_TIMEOUT', 'ERR_CONNECTION_TIMED_OUT'],
  timeout: ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'],
  tls_certificate_error: [
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_GET_ISSUER_CERT',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'ERR_CERT_AUTHORITY_INVALID',
    'ERR_CERT_DATE_INVALID',
    'ERR_CERT_COMMON_NAME_INVALID',
    'ERR_CERT_INVALID',
    'ERR_CERT_REVOKED'
  ],
  tls_handshake_error: [
    'EPROTO',
    'ERR_SSL_PROTOCOL_ERROR',
    'ERR_SSL_VERSION_OR_CIPHER_MISMATCH',
    'ERR_SSL_WRONG_VERSION_NUMBER',
    'ERR_TLS_HANDSHAKE_TIMEOUT',
    'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE'
  ],
  proxy_error: [
    'ERR_PROXY_CONNECTION_FAILED',
    'ERR_TUNNEL_CONNECTION_FAILED',
    'ERR_PROXY_TUNNEL',
    'ERR_SOCKS_CONNECTION_FAILED',
    'ERR_NO_SUPPORTED_PROXIES',
    'ERR_MANDATORY_PROXY_CONFIGURATION_FAILED',
    'ERR_PROXY_CERTIFICATE_INVALID'
  ],
  proxy_auth_error: [
    'ERR_PROXY_AUTH_REQUESTED',
    'ERR_PROXY_AUTH_UNSUPPORTED',
    'ERR_PROXY_AUTH_REQUIRED'
  ],
  network_error: [
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
    'UND_ERR_SOCKET',
    'ERR_CONNECTION_RESET',
    'ERR_CONNECTION_CLOSED',
    'ERR_NETWORK_CHANGED',
    'ERR_FAILED',
    'ERR_TIMED_OUT',
    'ERR_EMPTY_RESPONSE'
  ]
} satisfies Partial<Record<ConnectionTestStatus, string[]>>

const codeStatus = new Map<string, ConnectionTestStatus>(
  Object.entries(codesByStatus).flatMap(([status, codes]) =>
    codes.map((code) => [code, status as ConnectionTestStatus])
  )
)

export function classifyConnectionError(
  error: unknown,
  signal: AbortSignal,
  deadline: AbortSignal
): { status: ConnectionTestStatus; errorCode?: string; httpStatus?: number } {
  if (signal.aborted)
    return {
      status: signal.reason === deadline.reason && deadline.aborted ? 'timeout' : 'cancelled'
    }
  let failure: ConnectionTestStatus = 'network_error'
  let observedCode: string | undefined
  const visited = new Set<object>()
  while (error && typeof error === 'object' && !visited.has(error) && visited.size < 16) {
    visited.add(error)
    if (error instanceof ResponsesWebSocketError) return { status: error.kind }
    if (error instanceof ResponseSizeError) return { status: 'invalid_response' }
    if (error instanceof ProviderTransportError) failure = error.kind
    const { code, message, cause, name, syscall, statusCode, proxyTunnelTimeout } = error as {
      code?: unknown
      message?: unknown
      cause?: unknown
      name?: unknown
      syscall?: unknown
      statusCode?: unknown
      proxyTunnelTimeout?: unknown
    }
    if (code === 'ERR_PROXY_TUNNEL' && statusCode === 407)
      return { status: 'proxy_auth_error', errorCode: code, httpStatus: 407 }
    if (
      code === 'ERR_PROXY_TUNNEL' &&
      typeof proxyTunnelTimeout === 'number' &&
      proxyTunnelTimeout > 0
    )
      return { status: 'connection_timeout', errorCode: code }
    if (name === 'TimeoutError') return { status: 'timeout' }
    // Chromium surfaces net errors as messages. Only trust exact, known tokens.
    const chromium =
      typeof message === 'string' ? /^net::(ERR_[A-Z0-9_]+)$/.exec(message)?.[1] : undefined
    const knownCode = typeof code === 'string' && codeStatus.has(code) ? code : chromium
    const status = knownCode ? codeStatus.get(knownCode) : undefined
    if (status && status !== 'network_error' && failure === 'network_error')
      return { status, errorCode: knownCode }
    if (knownCode === 'ETIMEDOUT' && syscall === 'connect' && failure === 'network_error')
      return { status: 'connection_timeout', errorCode: knownCode }
    if (status) observedCode ??= knownCode
    error = cause
  }
  return { status: failure, ...(observedCode ? { errorCode: observedCode } : {}) }
}

const upstreamCodes = new Set([
  'invalid_request_error',
  'invalid_parameter',
  'invalid_value',
  'unsupported_value',
  'unsupported_parameter',
  'unknown_parameter',
  'missing_required_parameter',
  'model_not_found',
  'model_not_supported',
  'context_length_exceeded',
  'invalid_api_key',
  'insufficient_quota',
  'rate_limit_exceeded'
])
const upstreamParameters = new Set([
  'model',
  'max_tokens',
  'max_completion_tokens',
  'max_output_tokens',
  'temperature',
  'top_p',
  'reasoning_effort',
  'reasoning.effort',
  'tools',
  'tool_choice',
  'messages',
  'input',
  'stream',
  'store'
])

export function upstreamProbeDiagnostic(payload: unknown): ProviderUpstreamDiagnostic | undefined {
  const error = objectRecord(objectRecord(payload)?.error)
  if (!error) return undefined
  const code =
    typeof error.code === 'string' && upstreamCodes.has(error.code) ? error.code : undefined
  const parameter =
    typeof error.param === 'string' && upstreamParameters.has(error.param) ? error.param : undefined
  if (!code && !parameter) return undefined
  return {
    ...(code ? { code } : {}),
    ...(parameter ? { parameter } : {})
  }
}

export function classifyConnectionHttp(
  status: number,
  error?: ProviderUpstreamDiagnostic
): ConnectionTestStatus {
  switch (status) {
    case 400:
    case 422:
      return error?.code === 'model_not_found' ? 'model_not_found' : 'request_error'
    case 401:
      return 'auth_error'
    case 403:
      return 'forbidden'
    case 404:
      return 'model_not_found'
    case 407:
      return 'proxy_auth_error'
    case 429:
      return 'rate_limited'
    default:
      return status >= 500 ? 'upstream_error' : 'endpoint_error'
  }
}

export function classifyProbeBody(
  text: string,
  protocol: string,
  websocket: boolean
): ConnectionTestStatus {
  if (websocket) {
    let status: ConnectionTestStatus = 'invalid_response'
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue
      const event = parseObject(line.slice(6))
      if (event?.type === 'response.completed') status = 'success'
      if (event?.type === 'response.incomplete')
        return reachedProbeTokenLimit(objectRecord(event.response)) ? 'success' : 'model_error'
      if (event?.type === 'response.failed') return 'model_error'
    }
    return status
  }
  const response = parseObject(text)
  if (!response) return 'invalid_response'
  if (response.error || response.status === 'failed') return 'model_error'
  if (protocol === 'openai-responses' && response.status === 'incomplete')
    return reachedProbeTokenLimit(response) ? 'success' : 'model_error'
  const shape = {
    'anthropic-messages': 'content',
    'google-generative-ai': 'candidates',
    'openai-responses': 'output',
    'openai-completions': 'choices'
  } as const
  const field = shape[protocol as keyof typeof shape]
  if (Array.isArray(response[field]) && response[field].length) return 'success'
  return Object.values(shape).some((key) => key !== field && Array.isArray(response[key]))
    ? 'protocol_error'
    : 'invalid_response'
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    return objectRecord(JSON.parse(text))
  } catch {
    // Invalid or non-JSON response.
  }
  return undefined
}

function reachedProbeTokenLimit(response: Record<string, unknown> | undefined) {
  return (
    Array.isArray(response?.output) &&
    objectRecord(response?.incomplete_details)?.reason === 'max_output_tokens'
  )
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
