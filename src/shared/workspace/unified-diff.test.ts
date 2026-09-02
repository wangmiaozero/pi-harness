import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './unified-diff'

describe('parseUnifiedDiff', () => {
  it('tracks old and new line numbers across hunks', () => {
    const lines = parseUnifiedDiff(
      [
        'diff --git a/demo.ts b/demo.ts',
        '--- a/demo.ts',
        '+++ b/demo.ts',
        '@@ -10,3 +10,4 @@',
        ' const one = 1',
        '-const two = 2',
        '+const two = 20',
        '+const three = 3',
        ' export default one'
      ].join('\n')
    )

    expect(lines.map(({ kind, oldLine, newLine }) => ({ kind, oldLine, newLine }))).toEqual([
      { kind: 'meta', oldLine: null, newLine: null },
      { kind: 'meta', oldLine: null, newLine: null },
      { kind: 'meta', oldLine: null, newLine: null },
      { kind: 'hunk', oldLine: null, newLine: null },
      { kind: 'context', oldLine: 10, newLine: 10 },
      { kind: 'deletion', oldLine: 11, newLine: null },
      { kind: 'addition', oldLine: null, newLine: 11 },
      { kind: 'addition', oldLine: null, newLine: 12 },
      { kind: 'context', oldLine: 12, newLine: 13 }
    ])
  })
})
