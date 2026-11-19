import type { GatewayModel } from '@shared/providers/gateway'
import type { PiModelConfig, PiProviderConfig } from '@shared/types/pi'
import { ValidationError } from './errors'

const protocols = new Set(['openai-completions', 'openai-responses', 'anthropic-messages'])

export class GatewayModelError extends ValidationError {
  constructor(
    readonly gatewayCode: string,
    message: string
  ) {
    super(message)
  }
}

export function gatewayEndpoint(baseUrl: string | undefined, gatewayBaseUrl?: string) {
  const url = URL.parse(baseUrl ?? '')
  if (
    !url ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return { unavailable: 'invalid_endpoint' as const }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const loopback =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^127\.(?:\d+\.){2}\d+$/.test(hostname) ||
    ['0.0.0.0', '[::]', '[::1]'].includes(hostname) ||
    /^\[::ffff:7f[\da-f]{2}:/.test(hostname)
  if (gatewayBaseUrl && loopback && port(url) === port(new URL(gatewayBaseUrl)))
    return { unavailable: 'recursive_upstream' as const }
  return { url }
}

function port(url: URL) {
  return url.port || (url.protocol === 'https:' ? '443' : '80')
}

export function gatewayModel(
  key: string,
  model: PiModelConfig,
  provider: PiProviderConfig,
  disabled: boolean,
  endpointError?: GatewayModel['unavailable']
): GatewayModel {
  const protocol = model.api ?? provider.api ?? 'openai-completions'
  return {
    id: `${key}/${model.id}`,
    provider: key,
    model: model.id,
    protocol,
    unavailable: disabled
      ? 'disabled'
      : !protocols.has(protocol)
        ? 'unsupported_protocol'
        : endpointError
  }
}
