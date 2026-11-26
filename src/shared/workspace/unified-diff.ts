export type UnifiedDiffLineKind = 'meta' | 'hunk' | 'context' | 'addition' | 'deletion'

export interface UnifiedDiffLine {
  kind: UnifiedDiffLineKind
  oldLine: number | null
  newLine: number | null
  text: string
}

export interface UnifiedDiffChangeCount {
  additions: number
  deletions: number
}

export type SplitDiffRow =
  | { kind: 'marker'; line: UnifiedDiffLine }
  | { kind: 'code'; before: UnifiedDiffLine | null; after: UnifiedDiffLine | null }

export function splitUnifiedDiffLines(lines: readonly UnifiedDiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  const before: UnifiedDiffLine[] = []
  const after: UnifiedDiffLine[] = []
  function flushChanges(): void {
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      rows.push({ kind: 'code', before: before[i] ?? null, after: after[i] ?? null })
    }
    before.length = 0
    after.length = 0
  }

  for (const line of lines) {
    if (line.kind === 'deletion') before.push(line)
    else if (line.kind === 'addition') after.push(line)
    else {
      flushChanges()
      rows.push(
        line.kind === 'context'
          ? { kind: 'code', before: line, after: line }
          : { kind: 'marker', line }
      )
    }
  }
  flushChanges()
  return rows
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

export function countUnifiedDiffChanges(patch: string): UnifiedDiffChangeCount {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { additions, deletions }
}
