export function fetchKiloListing(options?: {
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<unknown>
export function postKiloStreamed(options: {
  body: unknown
  signal?: AbortSignal
  onData: (data: string) => void
  timeoutMs?: number
}): Promise<void>
