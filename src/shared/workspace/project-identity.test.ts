import { describe, expect, it } from 'vitest'
import { isPathWithinProjectRoots, projectIdentityKey } from './project-identity'
import { sessionPathKey } from './session-path'

describe('identity keys', () => {
  it('case-folds Windows project roots', () => {
    expect(projectIdentityKey('C:\\Repo\\', 'win32')).toBe('c:\\repo')
    expect(projectIdentityKey('c:/Repo', 'win32')).toBe('c:\\repo')
  })

  it('keeps POSIX case', () => {
    expect(projectIdentityKey('/Users/Me/App/', 'darwin')).toBe('/Users/Me/App')
  })

  it('infers the path platform without relying on a Node runtime global', () => {
    expect(projectIdentityKey('C:/Repo/')).toBe('c:\\repo')
    expect(projectIdentityKey('//Server/Share/Repo/')).toBe('\\\\server\\share\\repo')
    expect(projectIdentityKey('/Users/Me/App/')).toBe('/Users/Me/App')
  })

  it('case-folds Windows session paths', () => {
    expect(sessionPathKey('C:\\pi\\a.jsonl', 'win32')).toBe('c:\\pi\\a.jsonl')
  })

  it('associates files with project roots without Node path APIs', () => {
    expect(isPathWithinProjectRoots('/code/app/src/index.ts', ['/code/app'])).toBe(true)
    expect(isPathWithinProjectRoots('/code/app-other/index.ts', ['/code/app'])).toBe(false)
    expect(isPathWithinProjectRoots('c:\\repo\\src\\index.ts', ['C:/Repo'])).toBe(true)
  })
})
