// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArchifyProvider } from './archify'
import { scanProject } from './scanner'
import { extractGraph } from './graph'
import { toErrorPayload } from '../services/errors'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true })
})
async function temporary(): Promise<string> {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'architecture-render-'))
  )
  directories.push(directory)
  return directory
}
function provider(temporaryRoot: string, resources = path.resolve('resources/archify')) {
  return new ArchifyProvider(resources, temporaryRoot)
}

describe('architecture rendering for real source layouts', () => {
  it('renders long Unicode names, duplicate basenames and dense cyclic imports with full source references', async () => {
    const root = await temporary()
    const files = [
      'src/renderer/src/components/chat/ToolCallView.vue',
      'src/renderer/src/components/chat/MessageView.vue',
      'src/renderer/src/components/chat/ToolCallView.test.ts',
      'packages/api/index.ts',
      'packages/web/index.ts',
      `src/${'架构'.repeat(15)}/${'项目模块'.repeat(12)}.ts`,
      `src/${'long-directory-'.repeat(15)}/${'long-module-'.repeat(12)}.ts`,
      ...Array.from({ length: 41 }, (_, i) => `module-${i}.ts`)
    ]
    for (const [i, file] of files.entries()) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
      const imports = [files[0], files[3], files[(i + 1) % files.length]]
        .filter((target) => target !== file)
        .map((target) => {
          const relative = path.posix.relative(path.posix.dirname(file), target)
          return `import '${relative.startsWith('.') ? relative : `./${relative}`}'`
        })
        .join('\n')
      await fs.writeFile(
        path.join(root, file),
        file.endsWith('.vue') ? `<script>${imports}</script>` : imports
      )
    }
    const signal = new AbortController().signal
    const graph = extractGraph(root, await scanProject(root, signal))
    expect(graph.nodes).toHaveLength(48)
    expect(graph.edges.length).toBeGreaterThan(100)
    const original = JSON.stringify(graph)
    const html = await provider(await temporary()).render(graph, signal, 'zh-CN')
    expect(html).toContain('ToolCallView.vue')
    expect(html).toContain('ToolCallView.test.ts')
    expect(html).toContain('packages/api')
    expect(html).toContain('packages/web')
    expect(html).toContain('…')
    expect(
      new Set([...html.matchAll(/data-node-id="(n-[a-f0-9]{16})"/g)].map((match) => match[1])).size
    ).toBe(48)
    expect(JSON.stringify(graph)).toBe(original)
    for (const file of files)
      expect(
        graph.nodes.some((node) =>
          node.sourceReferences.some((reference) => reference.path === file)
        )
      ).toBe(true)
  }, 30000)

  const projects = [
    path.resolve('.'),
    ...(process.env.PI_HARNESS_ARCHIFY_TEST_ROOT ? [process.env.PI_HARNESS_ARCHIFY_TEST_ROOT] : [])
  ]
  for (const root of projects)
    it(`renders every page and a dense neighborhood of ${path.basename(root)}`, async () => {
      const signal = new AbortController().signal
      const graph = extractGraph(root, await scanProject(root, signal))
      expect(graph.nodes.length).toBeGreaterThan(48)
      const renderer = provider(await temporary())
      for (let offset = 0; offset < graph.nodes.length; offset += 48) {
        const nodes = graph.nodes.slice(offset, offset + 48)
        const ids = new Set(nodes.map((node) => node.id))
        const html = await renderer.render(
          {
            ...graph,
            nodes,
            edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
          },
          signal,
          'en'
        )
        expect(
          new Set([...html.matchAll(/data-node-id="(n-[a-f0-9]{16})"/g)].map((match) => match[1]))
            .size
        ).toBe(nodes.length)
      }
      const hub = [...graph.nodes].sort(
        (a, b) =>
          graph.edges.filter((edge) => edge.source === b.id || edge.target === b.id).length -
          graph.edges.filter((edge) => edge.source === a.id || edge.target === a.id).length
      )[0]
      const neighbors = new Set(
        graph.edges
          .filter((edge) => edge.source === hub.id || edge.target === hub.id)
          .flatMap((edge) => [edge.source, edge.target])
      )
      const nodes = [
        hub,
        ...graph.nodes.filter((node) => node.id !== hub.id && neighbors.has(node.id))
      ].slice(0, 48)
      const ids = new Set(nodes.map((node) => node.id))
      expect(
        await renderer.render(
          {
            ...graph,
            nodes,
            edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
          },
          signal,
          'zh-CN'
        )
      ).toContain(`data-node-id="${hub.id}"`)
    }, 90000)

  it('returns a recoverable error without subprocess commands or paths and preserves cancellation', async () => {
    const root = await temporary()
    await fs.writeFile(path.join(root, 'main.ts'), 'export const value=1')
    const signal = new AbortController().signal
    const graph = extractGraph(root, await scanProject(root, signal))
    const renderer = provider(await temporary(), path.join(root, 'missing-renderer'))
    const payload = await renderer.render(graph, signal, 'en').catch(toErrorPayload)
    expect(payload).toMatchObject({ code: 'PROCESS_FAILED', recoverable: true })
    expect(JSON.stringify(payload)).not.toContain(root)
    expect(JSON.stringify(payload)).not.toMatch(
      /Command failed|execFile|stderr|render-architecture.mjs/
    )
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(renderer.render(graph, controller.signal, 'en')).rejects.toThrow('cancelled')
  })
})
