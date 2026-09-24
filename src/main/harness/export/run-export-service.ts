/**
 * Run Export & Debug Bundle.
 *
 * Everything exported passes through the secret redactor first. API keys,
 * tokens and credentials never leave the machine through an export.
 */

import { dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import { redactSecrets, redactSecretText } from '../../services/logger'
import type {
  HarnessArtifact,
  HarnessDiagnostic,
  HarnessEvaluation,
  HarnessExportResult,
  HarnessInsight,
  HarnessRegressionReport,
  HarnessRun,
  HarnessRunTrace
} from '@shared/types/harness'

export interface RunExportPayload {
  run: HarnessRun
  trace: HarnessRunTrace | null
  evaluation: HarnessEvaluation | null
  artifacts: HarnessArtifact[]
  diagnostics: HarnessDiagnostic[]
  insights: HarnessInsight[]
  regression: HarnessRegressionReport | null
}

export interface DebugBundleContext {
  appVersion: string
  piVersion: string | null
  platform: string
  nodeVersion: string
}

export class RunExportService {
  constructor(private readonly context: DebugBundleContext) {}

  async exportRun(
    payload: RunExportPayload,
    format: 'json' | 'markdown',
    defaultName?: string
  ): Promise<HarnessExportResult> {
    const body = format === 'json' ? this.renderJson(payload) : this.renderMarkdown(payload)
    const ext = format === 'json' ? 'json' : 'md'
    const result = await dialog.showSaveDialog({
      defaultPath: `run-${sanitize(defaultName || payload.run.id)}.${ext}`,
      filters: [
        format === 'json'
          ? { name: 'JSON', extensions: ['json'] }
          : { name: 'Markdown', extensions: ['md'] }
      ]
    })
    if (result.canceled || !result.filePath) return { format, path: '', cancelled: true }
    await writeFile(result.filePath, body, 'utf8')
    return { format, path: result.filePath, cancelled: false }
  }

  async exportDebugBundle(
    payload: RunExportPayload | null,
    defaultName = 'pi-harness-debug-bundle'
  ): Promise<HarnessExportResult> {
    const bundle = redactSecrets({
      generatedAt: new Date().toISOString(),
      environment: {
        app: 'Pi-Harness',
        appVersion: this.context.appVersion,
        piVersion: this.context.piVersion,
        platform: this.context.platform,
        os: `${os.type()} ${os.release()}`,
        nodeVersion: this.context.nodeVersion,
        electron: process.versions.electron
      },
      run: payload ? this.renderJsonPayload(payload) : null
    })
    const result = await dialog.showSaveDialog({
      defaultPath: `${defaultName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) {
      return { format: 'json', path: '', cancelled: true }
    }
    await writeFile(result.filePath, JSON.stringify(bundle, null, 2) + '\n', 'utf8')
    return { format: 'json', path: result.filePath, cancelled: false }
  }

  renderJson(payload: RunExportPayload): string {
    return JSON.stringify(redactSecrets(this.renderJsonPayload(payload)), null, 2) + '\n'
  }

  renderMarkdown(payload: RunExportPayload): string {
    const { run, trace, evaluation, artifacts, diagnostics, insights, regression } = payload
    const lines: string[] = []
    lines.push(`# Run ${run.id}`, '')
    lines.push(
      `- Status: **${run.status}**`,
      `- Model: ${run.model ?? '—'} (${run.provider ?? '—'})`,
      `- Started: ${new Date(run.startedAt).toISOString()}`,
      `- Duration: ${run.finishedAt ? `${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s` : '—'}`,
      `- Tokens: ${run.usage.totalTokens.toLocaleString()} (in ${run.usage.inputTokens.toLocaleString()} / out ${run.usage.outputTokens.toLocaleString()})`,
      `- Cost: ${run.usage.estimatedCost === null ? '—' : `$${run.usage.estimatedCost.toFixed(4)}`}`,
      `- Tool calls: ${run.toolCallCount} (${run.toolFailureCount} failed)`,
      ''
    )
    lines.push('## Prompt', '', '```', redactSecretText(run.prompt), '```', '')
    if (run.result) {
      lines.push('## Result', '', '```', redactSecretText(run.result), '```', '')
    }
    if (run.error) {
      lines.push('## Error', '', '```', redactSecretText(run.error), '```', '')
    }
    if (trace) {
      lines.push('## Trace spans', '')
      lines.push('| type | name | status | duration |', '| --- | --- | --- | --- |')
      for (const span of trace.spans) {
        lines.push(
          `| ${span.type} | ${span.name} | ${span.status} | ${span.duration !== null ? `${span.duration}ms` : '—'} |`
        )
      }
      lines.push('')
    }
    if (evaluation) {
      lines.push(`## Evaluation — ${evaluation.status}`, '')
      for (const stage of evaluation.pipeline?.stages ?? []) {
        lines.push(`- ${stage.name}: ${stage.status}${stage.message ? ` — ${stage.message}` : ''}`)
      }
      lines.push('')
    }
    if (artifacts.length) {
      lines.push('## Artifacts', '')
      for (const artifact of artifacts) {
        lines.push(
          `- [${artifact.type}] ${artifact.name}${artifact.path ? ` (${artifact.path})` : ''}`
        )
      }
      lines.push('')
    }
    if (diagnostics.length) {
      lines.push('## Diagnostics', '')
      for (const diagnostic of diagnostics) {
        lines.push(`### ${diagnostic.title} (${diagnostic.category}, ${diagnostic.severity})`, '')
        lines.push(diagnostic.message)
        if (diagnostic.causeChain.length) {
          lines.push('', 'Root cause chain:', '')
          for (const cause of diagnostic.causeChain) {
            lines.push(`- ${cause.title}: ${cause.message}`)
          }
        }
        if (diagnostic.recommendation)
          lines.push('', `Recommendation: ${diagnostic.recommendation}`)
        lines.push('')
      }
    }
    if (insights.length) {
      lines.push('## Insights', '')
      for (const insight of insights) {
        lines.push(`- ${insight.kind}: ${JSON.stringify(insight.params)}`)
      }
      lines.push('')
    }
    if (regression) {
      lines.push(`## Regression vs baseline ${regression.baseline.runLabel}`, '')
      for (const finding of regression.findings) {
        lines.push(`- ${finding.severity} — ${finding.metric}: ${finding.message}`)
      }
      lines.push('')
    }
    return lines.join('\n')
  }

  private renderJsonPayload(payload: RunExportPayload) {
    return {
      run: payload.run,
      trace: payload.trace,
      evaluation: payload.evaluation,
      artifacts: payload.artifacts,
      diagnostics: payload.diagnostics,
      insights: payload.insights,
      regression: payload.regression
    }
  }
}

function sanitize(name: string): string {
  return name.replace(/[/\\:*?"<>|]+/g, '-').slice(0, 80) || 'run'
}
