export function assertOfficialUrl(value: string): URL
export type ReleaseFetcher = (url: string, options?: RequestInit) => Promise<Response>
export function fetchOfficial(
  value: string,
  fetcher?: ReleaseFetcher,
  options?: { signal?: AbortSignal; headers?: Record<string, string> }
): Promise<Response>
export function readBounded(response: Response, limit: number): Promise<Buffer>
