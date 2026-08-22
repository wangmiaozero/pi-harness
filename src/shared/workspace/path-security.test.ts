import { describe, expect, it } from 'vitest'
import { isPathWithin, isPathWithinRoots } from './path-security'

describe('path security', () => {
  it('allows a file inside its root', () => {
    expect(isPathWithin('/Users/me/proj/src/index.ts', '/Users/me/proj')).toBe(true)
    expect(isPathWithin('/Users/me/proj', '/Users/me/proj')).toBe(true)
  })

  it('rejects sibling prefix bypass and parent traversal', () => {
    expect(isPathWithin('/Users/me/proj-evil/secret', '/Users/me/proj')).toBe(false)
    expect(isPathWithin('/Users/me/proj/../other', '/Users/me/proj')).toBe(false)
  })

  it('handles Windows drive-letter case and separators', () => {
    expect(isPathWithin('c:\\repo\\src\\a.ts', 'C:/repo')).toBe(true)
    expect(isPathWithin('C:\\repo-other\\a.ts', 'C:\\repo')).toBe(false)
  })

  it('checks against a set of allowed roots', () => {
    const roots = new Set(['/Users/a/one', '/Users/a/two'])
    expect(isPathWithinRoots('/Users/a/two/file.ts', roots)).toBe(true)
    expect(isPathWithinRoots('/Users/a/three/file.ts', roots)).toBe(false)
  })
})
