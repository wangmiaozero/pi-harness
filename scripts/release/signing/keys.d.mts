import type { KeyObject } from 'node:crypto'
export function privateKeyFromSecret(secret?: string): KeyObject
export function generateReleaseKey(
  directory: string,
  keyId: string
): Promise<{ keyId: string; publicKey: string; revoked: boolean }>
