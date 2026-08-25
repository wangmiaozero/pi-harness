import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { parseGitSource, parseNpmSource, resolvePackageSource } from './package-source'

describe('package source security', () => {
  it('accepts normal npm package names and versions', () => {
    expect(parseNpmSource('npm:pi-tool')).toEqual({ name: 'pi-tool', version: null })
    expect(parseNpmSource('npm:@scope/pi-tool@1.2.3')).toEqual({
      name: '@scope/pi-tool',
      version: '1.2.3'
    })
  })

  it('rejects npm path traversal before resolving an install path', () => {
    const base = path.resolve('/managed/packages')
    expect(parseNpmSource('npm:../../outside')).toBeNull()
    expect(resolvePackageSource(base, 'npm:../../outside')).toMatchObject({
      type: 'unknown',
      installPath: null,
      managedRoot: null
    })
  })

  it('rejects git paths with either separator form of traversal', () => {
    expect(parseGitSource('git:https://example.com/owner/../outside.git')).toBeNull()
    expect(parseGitSource('git:https://example.com/owner\\..\\outside.git')).toBeNull()
  })
})
