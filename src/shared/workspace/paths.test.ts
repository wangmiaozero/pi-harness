import { describe, expect, it } from 'vitest'
import { isWindowsAbsolutePath, samePath, toNativePath, toSlashPath } from './paths'

describe('workspace paths', () => {
  it('detects Windows absolute paths regardless of host', () => {
    expect(isWindowsAbsolutePath('C:\\repo')).toBe(true)
    expect(isWindowsAbsolutePath('c:/repo')).toBe(true)
    expect(isWindowsAbsolutePath('\\\\server\\share')).toBe(true)
    expect(isWindowsAbsolutePath('/Users/me')).toBe(false)
  })

  it('compares Windows paths case-insensitively and across separators', () => {
    expect(samePath('C:\\repo\\src', 'c:/repo/src', 'win32')).toBe(true)
    expect(samePath('D:\\repo\\', 'D:\\repo', 'win32')).toBe(true)
    expect(samePath('C:\\repo', 'D:\\repo', 'win32')).toBe(false)
  })

  it('compares POSIX paths case-sensitively', () => {
    expect(samePath('/Users/me/app', '/Users/me/app', 'darwin')).toBe(true)
    expect(samePath('/Users/me/App', '/Users/me/app', 'darwin')).toBe(false)
  })

  it('normalizes git POSIX-style Windows paths to native separators', () => {
    expect(toNativePath('D:/repo/sub', 'win32')).toBe('D:\\repo\\sub')
    expect(toNativePath('/Users/me', 'darwin')).toBe('/Users/me')
  })

  it('slash-normalizes bookkeeping keys', () => {
    expect(toSlashPath('C:\\repo\\src')).toBe('C:/repo/src')
  })
})
