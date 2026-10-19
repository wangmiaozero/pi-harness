import type { TrustStore } from '../../../src/main/updater/security/manifest.mjs'
export function signCandidate(
  directory: string,
  keyId: string,
  secret: string | undefined,
  trust: TrustStore
): Promise<void>
