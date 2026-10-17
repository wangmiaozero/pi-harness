import type { RuntimeFetcher } from './distribution.mjs'
export const PI_SDK_PACKAGES: string[]
export function latestStable(versions: string[]): string | null
export function upstreamJson(url: string, fetcher?: RuntimeFetcher): Promise<unknown>
export function npmStable(
  name: string,
  fetcher?: RuntimeFetcher
): Promise<{
  version: string
  distTags: Record<string, string>
  engines: Record<string, string>
  peers: Record<string, string>
}>
export function githubStable(repository: string, fetcher?: RuntimeFetcher): Promise<string>
export function nodeLts(fetcher?: RuntimeFetcher): Promise<string>
