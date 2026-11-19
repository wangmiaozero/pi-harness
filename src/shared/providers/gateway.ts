export type GatewayModelUnavailable =
  | 'disabled'
  | 'unsupported_protocol'
  | 'invalid_endpoint'
  | 'recursive_upstream'
  | 'fallback_only'
  | 'unverified'

export interface GatewayModel {
  id: string
  provider: string
  model: string
  protocol: string
  unavailable?: GatewayModelUnavailable
  streamingOnly?: boolean
}

export interface LocalGatewayState {
  running: boolean
  baseUrl?: string
}

export interface LocalGatewayStatus extends LocalGatewayState {
  models: GatewayModel[]
}

export interface LocalGatewayConnection extends LocalGatewayState {
  running: true
  baseUrl: string
}

/** The account namespace is reserved so one gateway ID cannot route to two upstreams. */
export const gatewayAccountKey = /^chatgpt-account-[0-9a-f-]{36}$/
