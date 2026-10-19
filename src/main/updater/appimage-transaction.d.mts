import type { TrustedCandidate } from './update-provider'
export function stageAppImage(
  current: string,
  verified: string,
  candidate: TrustedCandidate
): Promise<{ backup: string; target: string }>
