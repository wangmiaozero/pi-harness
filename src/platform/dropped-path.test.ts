import { describe, expect, it, beforeEach } from 'vitest'
import {
  extractDroppedPath,
  matchDroppedPathByName,
  rememberNativeDropPaths,
  resetNativeDropPaths,
  resolveDroppedFilePath
} from './dropped-path'

describe('dropped-path', () => {
  beforeEach(() => {
    resetNativeDropPaths()
  })

  it('extracts string, {path}, File.path, and absolute File.name', () => {
    expect(extractDroppedPath('/tmp/proj')).toBe('/tmp/proj')
    expect(extractDroppedPath({ path: '/tmp/proj' })).toBe('/tmp/proj')
    expect(extractDroppedPath({ path: '/tmp/proj', name: 'proj' })).toBe('/tmp/proj')
    expect(extractDroppedPath({ name: 'C:\\code\\proj' })).toBe('C:\\code\\proj')
    expect(extractDroppedPath({ name: 'proj' })).toBeNull()
    expect(extractDroppedPath(null)).toBeNull()
  })

  it('matches a native drop path by folder name', () => {
    expect(matchDroppedPathByName('proj', ['/Users/me/code/proj'])).toBe('/Users/me/code/proj')
    expect(matchDroppedPathByName('proj', ['/Users/me/code/proj/'])).toBe('/Users/me/code/proj/')
    expect(matchDroppedPathByName('other', ['/Users/me/code/proj'])).toBeNull()
  })

  it('resolves WKWebView File.name against the last native drop', () => {
    rememberNativeDropPaths(['/Users/me/code/pi-harness'])
    expect(resolveDroppedFilePath({ name: 'pi-harness' })).toBe('/Users/me/code/pi-harness')
  })

  it('ignores stale native drop cache', () => {
    rememberNativeDropPaths(['/tmp/proj'], Date.now() - 4000)
    expect(resolveDroppedFilePath({ name: 'proj' })).toBeNull()
  })
})
