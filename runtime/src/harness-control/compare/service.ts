/**
 * Run Compare.
 *
 * Side-by-side metrics plus real diffs (prompt, configuration, tools, files,
 * evaluation). Diff hunks come from a simple line LCS — no external
 * dependencies, honest output.
 */

import type {
  HarnessArtifact,
  HarnessEvaluation,
  HarnessRun,
  HarnessRunComparison,
  HarnessRunComparisonMetric,
  HarnessRunDiffLine,
  HarnessRunDiffSection
} from '../types.js'

export interface CompareInputs {
  runA: HarnessRun
  runB: HarnessRun
  evaluationA: HarnessEvaluation | null
  evaluationB: HarnessEvaluation | null
  artifactsA: HarnessArtifact[]
  artifactsB: HarnessArtifact[]
}

export function compareRuns(inputs: CompareInputs): HarnessRunComparison {
  return {
    runA: inputs.runA,
    runB: inputs.runB,
    metrics: buildMetrics(inputs),
    diffs: buildDiffs(inputs),
    findings: [],
    comparedAt: Date.now()
  }
}

function buildMetrics(inputs: CompareInputs): HarnessRunComparisonMetric[] {
  const { runA, runB } = inputs
  const metrics: HarnessRunComparisonMetric[] = []

  metrics.push(textMetric('model', runA.model ?? '—', runB.model ?? '—'))
  metrics.push(textMetric('provider', runA.provider ?? '—', runB.provider ?? '—'))
  metrics.push(
    numberMetric('tokens', runA.usage.totalTokens, runB.usage.totalTokens, 'lower')
  )
  metrics.push(
    numberMetric(
      'cost',
      runA.usage.estimatedCost ?? Number.NaN,
      runB.usage.estimatedCost ?? Number.NaN,
      'lower',
      (value) => (Number.isFinite(value) ? `$${value.toFixed(4)}` : '—')
    )
  )
  metrics.push(
    numberMetric(
      'duration',
      runA.finishedAt ? runA.finishedAt - runA.startedAt : Number.NaN,
      runB.finishedAt ? runB.finishedAt - runB.startedAt : Number.NaN,
      'lower',
      formatDurationSafe
    )
  )
  metrics.push(numberMetric('toolCalls', runA.toolCallCount, runB.toolCallCount, 'lower'))
  metrics.push(numberMetric('toolFailures', runA.toolFailureCount, runB.toolFailureCount, 'lower'))
  metrics.push(
    numberMetric(
      'contextPeak',
      runA.contextUsage?.percent ?? Number.NaN,
      runB.contextUsage?.percent ?? Number.NaN,
      'lower',
      (value) => (Number.isFinite(value) ? `${value.toFixed(1)}%` : '—')
    )
  )
  metrics.push(
    textMetric(
      'tests',
      stageStatus(inputs.evaluationA, 'test'),
      stageStatus(inputs.evaluationB, 'test')
    )
  )
  metrics.push(
    textMetric(
      'build',
      stageStatus(inputs.evaluationA, 'build'),
      stageStatus(inputs.evaluationB, 'build')
    )
  )
  metrics.push(
    textMetric(
      'evaluation',
      inputs.evaluationA?.status ?? '—',
      inputs.evaluationB?.status ?? '—'
    )
  )
  metrics.push(textMetric('status', runA.status, runB.status))
  return metrics
}

function buildDiffs(inputs: CompareInputs): HarnessRunDiffSection[] {
  const sections: HarnessRunDiffSection[] = []
  sections.push(lineDiffSection('prompt', splitLines(inputs.runA.prompt), splitLines(inputs.runB.prompt)))
  sections.push(configurationDiff(inputs))
  sections.push(toolsDiff(inputs))
  sections.push(filesDiff(inputs))
  sections.push(evaluationDiff(inputs))
  return sections.filter((section) => section.lines.length > 0)
}

function configurationDiff(inputs: CompareInputs): HarnessRunDiffSection {
  const a: string[] = []
  const b: string[] = []
  a.push(`model: ${inputs.runA.model ?? '—'}`)
  b.push(`model: ${inputs.runB.model ?? '—'}`)
  a.push(`provider: ${inputs.runA.provider ?? '—'}`)
  b.push(`provider: ${inputs.runB.provider ?? '—'}`)
  a.push(`status: ${inputs.runA.status}`)
  b.push(`status: ${inputs.runB.status}`)
  return lineDiffSection('configuration', a, b)
}

function toolsDiff(inputs: CompareInputs): HarnessRunDiffSection {
  const toolsA = countTools(inputs.runA)
  const toolsB = countTools(inputs.runB)
  const names = [...new Set([...Object.keys(toolsA), ...Object.keys(toolsB)])].sort()
  const a = names.map((name) => `${name}: ${toolsA[name] ?? 0}`)
  const b = names.map((name) => `${name}: ${toolsB[name] ?? 0}`)
  return lineDiffSection('tools', a, b)
}

function filesDiff(inputs: CompareInputs): HarnessRunDiffSection {
  const filesA = new Set(
    inputs.artifactsA.filter((artifact) => artifact.type === 'file').map((artifact) => artifact.name)
  )
  const filesB = new Set(
    inputs.artifactsB.filter((artifact) => artifact.type === 'file').map((artifact) => artifact.name)
  )
  const lines: HarnessRunDiffLine[] = []
  for (const file of [...filesA].sort()) {
    lines.push({ kind: filesB.has(file) ? 'same' : 'removed', text: file })
  }
  for (const file of [...filesB].sort()) {
    if (!filesA.has(file)) lines.push({ kind: 'added', text: file })
  }
  return { id: 'files', lines }
}

function evaluationDiff(inputs: CompareInputs): HarnessRunDiffSection {
  const stagesA = inputs.evaluationA?.pipeline?.stages ?? []
  const stagesB = inputs.evaluationB?.pipeline?.stages ?? []
  const byKind = (stages: typeof stagesA) =>
    new Map(stages.map((stage) => [stage.kind, stage.status]))
  const mapA = byKind(stagesA)
  const mapB = byKind(stagesB)
  const kinds = [...new Set([...mapA.keys(), ...mapB.keys()])].sort()
  const lines: HarnessRunDiffLine[] = []
  for (const kind of kinds) {
    const statusA = mapA.get(kind) ?? '—'
    const statusB = mapB.get(kind) ?? '—'
    lines.push({ kind: statusA === statusB ? 'same' : 'added', text: `${kind}: ${statusA} → ${statusB}` })
  }
  return { id: 'evaluation', lines }
}

function countTools(run: HarnessRun): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const step of run.steps) {
    if (step.kind !== 'tool') continue
    counts[step.name] = (counts[step.name] ?? 0) + 1
  }
  return counts
}

// ---------------------------------------------------------------------------
// Metric formatting helpers
// ---------------------------------------------------------------------------

function textMetric(id: string, a: string, b: string): HarnessRunComparisonMetric {
  return {
    id,
    a,
    b,
    delta: a === b ? null : `${a} → ${b}`,
    deltaPercent: null,
    // Text changes are differences, not degradations — stay neutral.
    tone: 'neutral'
  }
}

function numberMetric(
  id: string,
  a: number,
  b: number,
  better: 'lower' | 'higher',
  format: (value: number) => string = (value) => value.toLocaleString()
): HarnessRunComparisonMetric {
  const textA = Number.isFinite(a) ? format(a) : '—'
  const textB = Number.isFinite(b) ? format(b) : '—'
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
    return { id, a: textA, b: textB, delta: null, deltaPercent: null, tone: 'neutral' }
  }
  const percent = a > 0 ? Math.round(((b - a) / a) * 100) : null
  const improved = better === 'lower' ? b < a : b > a
  return {
    id,
    a: textA,
    b: textB,
    delta: `${percent !== null && percent > 0 ? '+' : ''}${percent ?? '—'}%`,
    deltaPercent: percent,
    tone: improved ? 'better' : 'worse'
  }
}

function stageStatus(
  evaluation: HarnessEvaluation | null,
  kind: 'test' | 'build'
): string {
  const stage = evaluation?.pipeline?.stages.find((item) => item.kind === kind)
  return stage?.status ?? '—'
}

function formatDurationSafe(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`
}

function splitLines(text: string): string[] {
  if (!text.trim()) return []
  return text.split('\n').map((line) => line.slice(0, 200))
}

/** Line diff via LCS — small inputs only (prompts and summaries). */
export function lineDiffSection(
  id: HarnessRunDiffSection['id'],
  a: readonly string[],
  b: readonly string[]
): HarnessRunDiffSection {
  const rows = lcsTable(a, b)
  const lines: HarnessRunDiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] ?? '' })
      i += 1
      j += 1
    } else if ((rows[i + 1]?.[j] ?? 0) >= (rows[i]?.[j + 1] ?? 0)) {
      lines.push({ kind: 'removed', text: a[i] ?? '' })
      i += 1
    } else {
      lines.push({ kind: 'added', text: b[j] ?? '' })
      j += 1
    }
  }
  while (i < a.length) {
    lines.push({ kind: 'removed', text: a[i] ?? '' })
    i += 1
  }
  while (j < b.length) {
    lines.push({ kind: 'added', text: b[j] ?? '' })
    j += 1
  }
  return { id, lines }
}

function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const rows: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = rows[i]
      const nextRow = rows[i + 1]
      if (!row || !nextRow) continue
      row[j] = a[i] === b[j] ? (nextRow[j + 1] ?? 0) + 1 : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  return rows
}
