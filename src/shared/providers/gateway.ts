export interface LocalGatewayState {
  running: boolean
  baseUrl?: string
}

export interface LocalGatewayConnection extends LocalGatewayState {
  running: true
  baseUrl: string
}
