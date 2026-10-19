import embedded from '../../../resources/update-capabilities.json'
import { stableVersion } from './security/manifest.mjs'
import type { UpdateReadiness } from '@shared/update'

export interface UpgradeEvidence {
  platform: string
  arch: string
  variant: string
  fromVersion: string
  toVersion: string
  checks: Record<string, string>
  native: boolean
  sourceDigest: string
}
const required = ['signature', 'integrity', 'upgrade', 'restart', 'data', 'runtimes', 'rollback']
export function validatedUpgradeEvidence(
  value: unknown,
  target: { platform: string; arch: string; variant: string; from: string; to: string }
): value is UpgradeEvidence {
  const evidence = value as UpgradeEvidence | null
  return Boolean(
    evidence &&
    evidence.native === true &&
    evidence.platform === target.platform &&
    evidence.arch === target.arch &&
    evidence.variant === target.variant &&
    evidence.fromVersion === target.from &&
    evidence.toVersion === target.to &&
    stableVersion.test(evidence.fromVersion) &&
    stableVersion.test(evidence.toVersion) &&
    /^[a-f0-9]{64}$/.test(evidence.sourceDigest) &&
    required.every((check) => evidence.checks?.[check] === 'PASS')
  )
}
export function installCapability(
  platform: string,
  arch: string,
  variant: string,
  from: string,
  to: string
) {
  const entry = (
    embedded.platforms as Record<
      string,
      { readiness: UpdateReadiness; format: string; evidence: unknown }
    >
  )[`${platform}-${arch}`]
  const verified =
    platform !== 'darwin' &&
    entry?.readiness === 'AUTO_INSTALL_VERIFIED' &&
    validatedUpgradeEvidence(entry.evidence, { platform, arch, variant, from, to })
  return {
    canInstall: Boolean(verified),
    readiness: (verified
      ? 'AUTO_INSTALL_VERIFIED'
      : entry?.readiness === 'AUTO_INSTALL_VERIFIED'
        ? 'MANUAL_ONLY'
        : (entry?.readiness ?? 'NOT_READY')) as UpdateReadiness,
    format: entry?.format ?? null
  }
}
