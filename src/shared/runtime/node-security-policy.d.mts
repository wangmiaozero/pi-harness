export interface NodeSecurityAssessment {
  version: string | null
  status: 'SUPPORTED' | 'OUTDATED' | 'VULNERABLE' | 'END_OF_LIFE' | 'UNVERIFIED'
  functionallyCompatible: boolean
  patchStatus: 'FIXED' | 'VULNERABLE' | 'UNKNOWN'
  lifecycle: 'END_OF_LIFE' | 'UNKNOWN' | 'MAINTENANCE_LTS' | 'ACTIVE_LTS' | 'CURRENT'
  baseline: string | null
  recommendedVersion: string
  executionAllowed: boolean
  reason: string
  remediation: string
  reviewedAt: string
  cves: string[]
}
export const nodeSecurityPolicy: {
  reviewedAt: string
  source: string
  recommendedVersion: string
  functionalMinimum: string
  lines: Record<string, { minimum: string; end: string; maintenance: string; lts: string }>
  cves: Array<{ id: string; severity: string; lines: number[] }>
}
export function assessNodeSecurity(
  input: string | null | undefined,
  now?: Date
): NodeSecurityAssessment
