export type RuntimeFetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>
import type { RuntimeKind } from '../../shared/runtime/schema'
export const catalog: {
  pi: {
    version: string
    checksumsFile: string
    assets: Record<string, { file: string; sha256: string }>
  }
  node: {
    version: string
    npmVersion: string
    assets: Record<string, { file: string; sha256: string }>
  }
}
export function sha256(file: string): Promise<string>
export function treeDigest(files: Record<string, string>): string
export function inventory(root: string): Promise<Record<string, string>>
export function assertArchivePath(name: string, link?: string, type?: string): void
export function runtimeLayout(
  kind: RuntimeKind,
  platform: string
): { executable: string; npm?: string; npx?: string }
export function verifyDistribution(
  root: string,
  kind: RuntimeKind,
  platform: string,
  arch: string
): Promise<unknown>
export function acquireDistribution(options: {
  kind: RuntimeKind
  platform: string
  arch: string
  destination: string
  cache: string
  offline?: boolean
  signal?: AbortSignal
  fetcher?: RuntimeFetcher
  onProgress?: (phase: string, progress: number) => void
}): Promise<unknown>

export function extractRuntimeZip(
  archive: string,
  staging: string,
  signal?: AbortSignal
): Promise<void>
export function extractRuntimeArchive(
  archive: string,
  staging: string,
  signal?: AbortSignal
): Promise<void>
