export type ProviderProxyMode = 'auto' | 'system' | 'direct' | 'custom'
export type AutomaticProxySource = 'environment' | 'system' | 'login_shell'
export type ProviderTransport = 'node_fetch' | 'electron_fetch' | 'responses_websocket'

export interface ProviderNetworkDiagnostic {
  proxyMode: ProviderProxyMode
  /** Set when a request is handed to the selected transport. */
  transport: ProviderTransport | null
  proxyRoute?: string
  automaticProxySource?: AutomaticProxySource
}

export interface ProviderUpstreamDiagnostic {
  code?: string
  parameter?: string
}

export const connectionHints = {
  success: 'The model responded.',
  auth_error: 'Check the provider credential and authentication settings.',
  forbidden: 'Check whether the credential can access this model and endpoint.',
  rate_limited: 'Check the provider limits and try again later.',
  dns_error: 'Check the endpoint hostname and DNS settings.',
  connection_refused: 'Check the endpoint address and whether the service is running.',
  network_unreachable: 'Check your network connection and routing.',
  connection_timeout: 'The connection could not be established in time.',
  timeout: 'The request did not finish before the configured timeout.',
  tls_certificate_error: 'Check the certificate, system time, and trusted certificates.',
  tls_handshake_error: 'Check the TLS configuration of the endpoint or proxy.',
  proxy_error: 'Check the selected proxy address and whether the proxy is running.',
  proxy_auth_error: 'The proxy requires authentication. Check its authentication settings.',
  network_error: 'Check the network and proxy settings. The failure stage could not be determined.',
  endpoint_error: 'Check the provider Base URL and API endpoint.',
  request_error:
    'The endpoint rejected the request. Check the model, API protocol, and request parameters.',
  upstream_error: 'The upstream service returned a server error.',
  model_not_found: 'Check the model ID and the provider Base URL.',
  model_error: 'The upstream rejected the model request.',
  protocol_error: 'Check whether the model and proxy support the selected protocol.',
  invalid_response:
    'The response does not match the selected API. Check the Base URL and protocol.',
  cancelled: 'The connection test was cancelled.',
  unknown_error: 'The selected provider could not be loaded.'
} as const

export type ConnectionTestStatus = keyof typeof connectionHints
