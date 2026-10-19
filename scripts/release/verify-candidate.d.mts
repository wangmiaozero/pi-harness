import type { TrustStore } from '../../src/main/updater/security/manifest.mjs'
export function verifyCandidate(
  directory: string,
  version: string,
  revision?: string,
  options?: { requireSignature?: boolean; trust?: TrustStore }
): Promise<void>
