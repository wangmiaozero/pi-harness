import semver from 'semver'
import policy from './node-security-policy.json' with { type: 'json' }

export { policy as nodeSecurityPolicy }

/** Patch evidence is scoped to the reviewed advisory, never a claim about all future CVEs. */
export function assessNodeSecurity(input, now = new Date()) {
  const version = typeof input === 'string' ? semver.valid(input.trim()) : null
  const major = version ? semver.major(version) : null
  const line = policy.lines[major]
  const date = now.toISOString().slice(0, 10)
  const stable = Boolean(version && !semver.prerelease(version))
  const functionallyCompatible = Boolean(stable && semver.gte(version, policy.functionalMinimum))
  const lifecycle =
    policy.endOfLifeMajors.includes(major) || (line && date >= line.end)
      ? 'END_OF_LIFE'
      : !line
        ? 'UNKNOWN'
        : date >= line.maintenance
          ? 'MAINTENANCE_LTS'
          : date >= line.lts
            ? 'ACTIVE_LTS'
            : 'CURRENT'
  const patchStatus =
    !stable || !line ? 'UNKNOWN' : semver.gte(version, line.minimum) ? 'FIXED' : 'VULNERABLE'
  const status = !stable
    ? 'UNVERIFIED'
    : lifecycle === 'END_OF_LIFE'
      ? 'END_OF_LIFE'
      : !line
        ? 'UNVERIFIED'
        : !functionallyCompatible
          ? 'OUTDATED'
          : patchStatus === 'VULNERABLE'
            ? 'VULNERABLE'
            : 'SUPPORTED'
  const reasons = {
    SUPPORTED: 'Meets the reviewed Node.js security baseline.',
    VULNERABLE: 'Missing required Node.js security fixes.',
    END_OF_LIFE: 'This Node.js release line no longer receives official security updates.',
    UNVERIFIED: 'This Node.js version has not been verified for secure use.',
    OUTDATED: 'This Node.js version is below the functional compatibility requirement.'
  }
  return {
    version,
    status,
    functionallyCompatible,
    patchStatus,
    lifecycle,
    baseline: line?.minimum ?? null,
    recommendedVersion: policy.recommendedVersion,
    executionAllowed: status === 'SUPPORTED',
    reason: reasons[status],
    remediation: `Choose the bundled runtime or install official Node.js ${policy.recommendedVersion} LTS and verify it in Settings.`,
    reviewedAt: policy.reviewedAt,
    cves: line ? policy.cves.filter((cve) => cve.lines.includes(major)).map((cve) => cve.id) : []
  }
}
