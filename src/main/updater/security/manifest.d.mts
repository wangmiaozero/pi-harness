export interface TrustStore {
  schemaVersion: number
  keys: Array<{ keyId: string; publicKey: string; revoked: boolean }>
}
export interface Installer {
  file: string
  size: number
  sha256: string
  platform: string
  arch: string
  variant: string
}
export interface Manifest {
  version: string
  channel: string
  revision: string
  artifacts: Installer[]
  releaseNotes?: string
  previewPlatforms?: string[]
}
export const releasePlatforms: string[]
export const releaseVariants: string[]
export const stableVersion: RegExp
export const keyIdentifier: RegExp
export function assetNames(version: string, platform: string, variant: string): string[]
export function trustedPublicKey(trust: TrustStore, keyId: string): import('node:crypto').KeyObject
export function verifyManifestSignature(bytes: Buffer, signature: Buffer, trust: TrustStore): string
export function parseManifest(bytes: Buffer, version: string, revision?: string): Manifest
export function verifiedManifest(
  bytes: Buffer,
  signature: Buffer,
  trust: TrustStore,
  version: string,
  revision?: string
): Manifest
export function selectInstaller(
  manifest: Manifest,
  platform: string,
  arch: string,
  variant: string
): Installer
export function verifyInstaller(file: string, item: Installer): Promise<void>
