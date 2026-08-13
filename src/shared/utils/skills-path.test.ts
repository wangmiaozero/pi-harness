import { describe, it, expect } from 'vitest'
import path from 'node:path'

/**
 * Mirrors SkillsService path-root defence without pulling Electron FS.
 * Keep in sync with skills-service assertInsideRoots.
 */
function assertInsideRoots(target: string, allowedRoots: string[]): boolean {
  const resolved = path.resolve(target)
  return allowedRoots.some((root) => {
    const r = path.resolve(root)
    return resolved === r || resolved.startsWith(r + path.sep)
  })
}

describe('skills path roots', () => {
  const roots = ['/Users/me/.pi/agent/skills', '/Users/me/.agents/skills']

  it('allows paths under a known root', () => {
    expect(assertInsideRoots('/Users/me/.pi/agent/skills/demo', roots)).toBe(true)
    expect(assertInsideRoots('/Users/me/.pi/agent/skills', roots)).toBe(true)
  })

  it('rejects path traversal escape', () => {
    expect(assertInsideRoots('/Users/me/.pi/agent/skills/../secrets', roots)).toBe(false)
    expect(assertInsideRoots('/tmp/evil', roots)).toBe(false)
  })

  it('rejects absolute arbitrary paths', () => {
    expect(assertInsideRoots('/etc/passwd', roots)).toBe(false)
  })
})
