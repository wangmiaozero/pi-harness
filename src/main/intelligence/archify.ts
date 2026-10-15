import { getRuntimeProvider } from '../runtime/active'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ArchitectureGraph, ArchitectureLocale } from '@shared/intelligence/schema'
import { AppError } from '../services/errors'
import { ARCHITECTURE_INTERACTIONS } from './viewer-interactions'

// Conservatively measure the upstream monospace labels, including wide Unicode.
// Only display text is shortened; node identities and source references stay intact.
function textUnits(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + (char.codePointAt(0)! > 127 ? 2 : 1), 0)
}
function compactLabel(text: string, limit: number): string {
  if (textUnits(text) <= limit) return text
  const segments = [
    ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)
  ].map((segment) => segment.segment)
  const half = Math.floor((limit - 2) / 2)
  let start = ''
  let end = ''
  for (const segment of segments) {
    if (textUnits(start + segment) > half) break
    start += segment
  }
  for (const segment of segments.reverse()) {
    if (textUnits(segment + end) > half) break
    end = segment + end
  }
  return `${start}…${end}`
}

export interface ArchitectureRendererProvider {
  id: string
  version?: string
  render(graph: ArchitectureGraph, signal: AbortSignal, locale: ArchitectureLocale): Promise<string>
}
export const VIEWER_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"

export class ArchifyProvider implements ArchitectureRendererProvider {
  readonly id = 'archify'
  readonly version = '3.0.1'
  constructor(
    private readonly resources: string,
    private readonly temporary: string,
    private readonly executable?: string
  ) {}
  async render(
    graph: ArchitectureGraph,
    signal: AbortSignal,
    locale: ArchitectureLocale
  ): Promise<string> {
    await fs.mkdir(this.temporary, { recursive: true })
    const dir = await fs.mkdtemp(path.join(this.temporary, 'render-'))
    try {
      // Layout is a provider concern. Context always retains the full graph.
      const nodes = graph.nodes.slice(0, 48)
      const ids = new Set(nodes.map((n) => n.id))
      const labels = nodes.map((node) => {
        const label = compactLabel(path.posix.basename(node.name), 44)
        const parent = path.posix.dirname(node.name)
        const sublabel = parent === '.' ? '' : compactLabel(parent, 54)
        const width = Math.max(
          230,
          Math.ceil(Math.max(textUnits(label) * 6.6, textUnits(sublabel) * 5.4)) + 20
        )
        return { label, sublabel, width }
      })
      const columnStep = Math.max(230, ...labels.map((label) => label.width)) + 90
      const positions = new Map(
        nodes.map((node, i) => [node.id, [40 + (i % 4) * columnStep, 60 + Math.floor(i / 4) * 190]])
      )
      const input = {
        schema_version: 1,
        diagram_type: 'architecture',
        meta: {
          output: 'map.html',
          title: graph.project.name,
          subtitle: `${nodes.length}/${graph.nodes.length} modules — source index`,
          locale: locale === 'zh-CN' ? 'zh-CN' : 'en',
          legend: {
            mode: 'auto',
            entries: {
              backend: { label: locale === 'zh-CN' ? '项目文件' : 'Project files' },
              frontend: { label: locale === 'zh-CN' ? '界面文件' : 'UI files' },
              database: {
                label: locale === 'zh-CN' ? '数据相关文件（推测）' : 'Data-related files (inferred)'
              }
            }
          }
        },
        components: nodes.map((n, i) => ({
          id: n.id,
          type: n.type === 'ui' ? 'frontend' : n.type === 'data' ? 'database' : 'backend',
          label: labels[i].label,
          sublabel: labels[i].sublabel,
          pos: [40 + (i % 4) * columnStep, 60 + Math.floor(i / 4) * 190],
          size: [labels[i].width, 90]
        })),
        connections: graph.edges
          .filter((e) => ids.has(e.source) && ids.has(e.target))
          .slice(0, 100)
          .map((e, i) => {
            const [fromX, fromY] = positions.get(e.source)!
            const [toX, toY] = positions.get(e.target)!
            // Every vertical segment stays in a column gutter and every
            // horizontal bridge in a row gutter. Dense fan-in cannot exhaust
            // Archify's automatic route budget and fall back through nodes.
            const departure = fromX + columnStep - 90 + 24
            const arrival = toX - 24
            const corridorY = fromY + 120 + (i % 5) * 8
            return {
              id: e.id,
              from: e.source,
              to: e.target,
              variant: 'dashed',
              fromSide: 'right',
              toSide: 'left',
              via: [
                [departure, fromY + 45],
                [departure, corridorY],
                [arrival, corridorY],
                [arrival, toY + 45]
              ]
            }
          })
      }
      if (!nodes.length) throw new Error('No readable source files were found.')
      await fs.writeFile(path.join(dir, 'input.json'), JSON.stringify(input))
      try {
        const provider = getRuntimeProvider()
        const runtimeNode = provider ? await provider.resolve('node') : null
        const executable =
          this.executable ??
          (runtimeNode?.valid ? runtimeNode.executablePath : null) ??
          (!process.versions.electron ? process.execPath : null)
        if (!executable) throw new Error('The selected Node runtime is unavailable')
        const environment = provider ? await provider.environment('extension') : process.env
        await promisify(execFile)(
          executable,
          [
            path.join(this.resources, 'renderers/architecture/render-architecture.mjs'),
            path.join(dir, 'input.json'),
            path.join(dir, 'map.html')
          ],
          {
            env: {
              ...environment,
              ELECTRON_RUN_AS_NODE: undefined,
              ARCHIFY_REPO_ROOT: undefined,
              NODE_OPTIONS: ''
            },
            cwd: dir,
            signal,
            timeout: 30_000,
            maxBuffer: 256_000,
            windowsHide: true
          }
        )
      } catch {
        signal.throwIfAborted()
        // Never expose subprocess commands, temporary paths or raw stderr via IPC.
        throw new AppError(
          'PROCESS_FAILED',
          'The architecture map could not be generated. Retry rendering; the source index is available.',
          undefined,
          undefined,
          { recoverable: true }
        )
      }
      signal.throwIfAborted()
      const html = await fs.readFile(path.join(dir, 'map.html'), 'utf8')
      if (html.length > 3_000_000 || /<script\b[^>]*\bsrc\s*=/i.test(html))
        throw new Error('Unsupported viewer resources.')
      const metadata = JSON.stringify({
        snapshotId: graph.snapshotId,
        fingerprint: graph.revision.fingerprint,
        coverage: graph.coverage,
        analysis: graph.analysis,
        warnings: graph.warnings
      }).replaceAll('<', '\\u003c')
      return secureViewer(
        html.replace(
          '</body>',
          `<script type="application/json" id="pi-architecture-quality">${metadata}</script></body>`
        )
      )
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
}

export function secureViewer(html: string): string {
  // Trusted upstream template and escaped, verified graph data only. Loaded
  // artifacts remain sandboxed even if the local snapshot has been tampered with.
  if (!html.includes('data-pi-architecture-gestures="2"')) {
    html = html.replace(
      /<script\b[^>]*\bdata-pi-architecture-gestures(?=[\s=>])[^>]*>[\s\S]*?<\/script>/g,
      ''
    )
    html = html.replace(
      '</body>',
      `<script data-pi-architecture-gestures="2">${ARCHITECTURE_INTERACTIONS}</script></body>`
    )
  }
  if (html.includes('data-pi-architecture-bridge')) return html
  const bridge = `<script data-pi-architecture-bridge>document.addEventListener('click',function(e){const a=e.target.closest('a');if(a)e.preventDefault();const n=e.target.closest('[data-node-id]');if(n)window.architectureSelection?.select(n.dataset.nodeId)});document.addEventListener('keydown',function(e){if(e.key==='Enter'){const n=e.target.closest('[data-node-id]');if(n)window.architectureSelection?.select(n.dataset.nodeId)}});</script>`
  return html
    .replace(
      '<head>',
      `<head><meta http-equiv="Content-Security-Policy" content="${VIEWER_CSP.replace('; sandbox allow-scripts', '')}">`
    )
    .replace('</body>', `${bridge}</body>`)
}
