import { describe, expect, it } from 'vitest'
import { assessNodeSecurity } from './node-security-policy.mjs'

const date = new Date('2026-10-22T00:00:00Z')
describe('Node security and lifecycle policy', () => {
  it('reports outdated functionality separately from patch and lifecycle state', () => {
    expect(assessNodeSecurity('22.18.0', date)).toMatchObject({
      status: 'OUTDATED',
      patchStatus: 'VULNERABLE',
      functionallyCompatible: false,
      executionAllowed: false
    })
  })
  it.each([
    ['24.22.0', 'VULNERABLE'],
    ['24.22.1', 'SUPPORTED'],
    ['22.23.3', 'VULNERABLE'],
    ['22.23.4', 'SUPPORTED'],
    ['26.12.0', 'VULNERABLE'],
    ['26.12.1', 'SUPPORTED'],
    ['20.20.2', 'END_OF_LIFE'],
    ['23.99.0', 'END_OF_LIFE'],
    ['25.9.0', 'END_OF_LIFE'],
    ['27.0.0', 'UNVERIFIED'],
    ['99.0.0', 'UNVERIFIED'],
    ['garbage', 'UNVERIFIED'],
    ['24.22.1-rc.1', 'UNVERIFIED'],
    ['24.22.1-nightly.1', 'UNVERIFIED']
  ])('%s is %s', (version, status) => {
    const result = assessNodeSecurity(version, date)
    expect(result.status).toBe(status)
    expect(result.executionAllowed).toBe(status === 'SUPPORTED')
  })
  it('separates functional compatibility from missing security fixes', () => {
    expect(assessNodeSecurity('24.22.0', date)).toMatchObject({
      functionallyCompatible: true,
      patchStatus: 'VULNERABLE',
      executionAllowed: false
    })
  })
  it('expires a previously maintained release line', () => {
    expect(assessNodeSecurity('22.23.4', new Date('2027-05-01')).status).toBe('END_OF_LIFE')
  })
  it('does not attribute Node 26-only vulnerabilities to Node 24', () => {
    const result = assessNodeSecurity('24.22.1', date)
    expect(result.cves).toHaveLength(8)
    expect(result.cves).not.toContain('CVE-2026-106070')
    expect(result.cves).not.toContain('CVE-2026-106071')
    expect(assessNodeSecurity('22.23.4', date).cves).toHaveLength(7)
  })
})
