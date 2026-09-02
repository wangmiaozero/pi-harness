export type UnifiedDiffLineKind =
  | 'meta'
  | 'hunk'
  | 'context'
  | 'addition'
  | 'deletion'

export interface UnifiedDiffLine {
  kind: UnifiedDiffLineKind
  oldLine: number | null
  newLine: number | null
  text: string
}

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/

export function parseUnifiedDiff(patch: string): UnifiedDiffLine[] {
  let oldLine = 0
  let newLine = 0

  return patch.split('\n').map((text) => {
    const hunk = text.match(HUNK_HEADER_RE)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      return { kind: 'hunk', oldLine: null, newLine: null, text }
    }

    if (text.startsWith('+') && !text.startsWith('+++')) {
      return { kind: 'addition', oldLine: null, newLine: newLine++, text }
    }
    if (text.startsWith('-') && !text.startsWith('---')) {
      return { kind: 'deletion', oldLine: oldLine++, newLine: null, text }
    }
    if (text.startsWith(' ') && (oldLine > 0 || newLine > 0)) {
      return { kind: 'context', oldLine: oldLine++, newLine: newLine++, text }
    }

    return { kind: 'meta', oldLine: null, newLine: null, text }
  })
}
