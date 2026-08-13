/**
 * Minimal line-level diff (Myers/LCS). No external dependency.
 *
 * Used by the Configuration Conflict "Compare" view to show Current Editor
 * (or last-loaded) vs Disk Version. We only need line granularity with
 * added / removed / unchanged segments — not a full patch format.
 */

export type DiffOp = 'equal' | 'added' | 'removed'

export interface DiffLine {
  op: DiffOp
  /** 1-indexed line number in the source side (left for equal/removed, right for added). */
  lineNumber: number
  text: string
}

export interface DiffResult {
  lines: DiffLine[]
  addedCount: number
  removedCount: number
  /** True when left and right are byte-identical. */
  identical: boolean
}

/** Split text into lines without a trailing empty entry for a final newline. */
function toLines(text: string): string[] {
  if (text === '') return []
  // Keep this simple and platform-agnostic: split on \n, drop a single trailing ''.
  const parts = text.split('\n')
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  return parts
}

/**
 * Compute a line diff between `left` (current/old) and `right` (disk/new).
 * Uses the classic LCS dynamic-programming approach; fine for config files
 * (typically a few hundred lines). Output alternates removed/added pairs so
 * the UI can render them as adjacent hunks.
 */
export function diffLines(left: string, right: string): DiffResult {
  const a = toLines(left)
  const b = toLines(right)

  const n = a.length
  const m = b.length

  // dp[i][j] = length of LCS of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const lines: DiffLine[] = []
  let added = 0
  let removed = 0
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ op: 'equal', lineNumber: i + 1, text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ op: 'removed', lineNumber: i + 1, text: a[i] })
      removed++
      i++
    } else {
      lines.push({ op: 'added', lineNumber: j + 1, text: b[j] })
      added++
      j++
    }
  }
  while (i < n) {
    lines.push({ op: 'removed', lineNumber: i + 1, text: a[i] })
    removed++
    i++
  }
  while (j < m) {
    lines.push({ op: 'added', lineNumber: j + 1, text: b[j] })
    added++
    j++
  }

  return { lines, addedCount: added, removedCount: removed, identical: left === right }
}

/** Compact summary e.g. "+3 −2" for the conflict dialog header. */
export function diffSummary(result: DiffResult): string {
  return `+${result.addedCount} −${result.removedCount}`
}
