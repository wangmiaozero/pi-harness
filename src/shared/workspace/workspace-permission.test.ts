import { describe, expect, it } from 'vitest'
import {
  ensureSingleMainFolder,
  findContainingWorkspaceFolder,
  isWorkspacePathWritable
} from './workspace-permission'

describe('workspace permission', () => {
  const folders = [
    { resolvedPath: '/code/main', readonly: false, exists: true },
    { resolvedPath: '/code/ref', readonly: true, exists: true },
    { resolvedPath: '/code/missing', readonly: false, exists: false }
  ]

  it('picks the most specific containing folder', () => {
    expect(
      findContainingWorkspaceFolder('/code/main/src/index.ts', [
        { resolvedPath: '/code' },
        { resolvedPath: '/code/main' }
      ])?.resolvedPath
    ).toBe('/code/main')
  })

  it('allows writes only inside existing non-readonly folders', () => {
    expect(isWorkspacePathWritable('/code/main/src/a.ts', folders)).toBe(true)
    expect(isWorkspacePathWritable('/code/ref/src/a.ts', folders)).toBe(false)
    expect(isWorkspacePathWritable('/code/missing/a.ts', folders)).toBe(false)
    expect(isWorkspacePathWritable('/tmp/outside.ts', folders)).toBe(false)
  })

  it('keeps a single main folder', () => {
    const next = ensureSingleMainFolder(
      [
        { role: 'main' as const },
        { role: 'reference' as const },
        { role: 'main' as const }
      ],
      2
    )
    expect(next.map((folder) => folder.role)).toEqual(['reference', 'reference', 'main'])
  })
})
