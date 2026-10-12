// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { scanProject } from './scanner'
import { extractGraph } from './graph'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
async function graphFixture(files: Record<string, string>) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'architecture-graph-')))
  roots.push(root)
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true })
    await fs.writeFile(path.join(root, name), text)
  }
  const scan = await scanProject(root, new AbortController().signal)
  return { scan, graph: extractGraph(root, scan) }
}
it('resolves Vue, JSONC path mappings, source extension substitution and local packages with actual lines', async () => {
  const { graph } = await graphFixture({
    'package.json':
      '{"name":"monorepo","workspaces":["packages/*"],"dependencies":{"@local/api":"workspace:*"}}',
    'tsconfig.base.json':
      '{/*comment*/"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}',
    'tsconfig.json': '{"extends":"./tsconfig.base.json"}',
    'src/App.vue':
      '<template><p>hello</p></template>\n<script setup lang="ts">\nimport { value } from "@/value"\nimport { api } from "@local/api"\n</script>',
    'src/value.ts': 'export const value=1',
    'src/main.mts': 'export { value } from "./value.js"\nconst asyncModule=import("./value.js")',
    'packages/api/package.json':
      '{"name":"@local/api","exports":{".":{"source":"./src/service.ts"}}}',
    'packages/api/src/service.ts': 'export const api=1'
  })
  const app = graph.nodes.find((n) => n.name === 'src/App.vue')!
  const targets = graph.edges
    .filter((e) => e.source === app.id)
    .map((e) => ({
      name: graph.nodes.find((n) => n.id === e.target)!.name,
      line: e.sourceReferences[0].startLine
    }))
  expect(targets).toEqual([
    { name: 'src/value.ts', line: 3 },
    { name: 'packages/api/src/service.ts', line: 4 }
  ])
  expect(graph.edges.find((e) => e.source === app.id)!.sourceReferences.map((r) => r.path)).toEqual(
    ['src/App.vue', 'tsconfig.base.json', 'tsconfig.json']
  )
  expect(graph.nodes.find((n) => n.name === 'packages/api/src/service.ts')!.packageManifest).toBe(
    'packages/api/package.json'
  )
  expect(graph.project.packages).toHaveLength(2)
  expect(graph.entrypoints).toContain('packages/api/src/service.ts')
  expect(
    graph.edges.find((e) => e.source === graph.nodes.find((n) => n.name === 'src/main.mts')!.id)
  ).toBeDefined()
})
it('recognizes literal CommonJS/import expressions but omits comments, computed and shadowed requires', async () => {
  const { graph } = await graphFixture({
    'main.cjs':
      'const x=require("./value")\n// require("./fake")\nconst y=import("./async")\nconst text="require(\'./fake\')"\nrequire(variable)',
    'shadow.ts': 'const require=(name:string)=>name; require("./fake")',
    'value.js': 'exports.value=1',
    'async.ts': 'export default 2',
    'fake.ts': 'export default 3'
  })
  expect(graph.edges.map((e) => graph.nodes.find((n) => n.id === e.target)!.name)).toEqual([
    'value.js',
    'async.ts'
  ])
  expect(graph.edges.every((e) => e.evidence === 'static-verified')).toBe(true)
})
it('never resolves excluded, ambiguous, escaping or unindexed imports and finds declared frameworks', async () => {
  const { graph, scan } = await graphFixture({
    '.gitignore': 'hidden.ts\n',
    'hidden.ts': 'export default 1',
    'tsconfig.node.json':
      '{"compilerOptions":{"paths":{"ambiguous":["./one.ts"],"escape":["../outside.ts"]}}}',
    'tsconfig.web.json': '{"compilerOptions":{"paths":{"ambiguous":["./two.ts"]}}}',
    'main.ts': 'import "./hidden"; import "ambiguous"; import "escape"; import "external-library"',
    'one.ts': 'export const one=1',
    'two.ts': 'export const two=1',
    'services/java/pom.xml': '<groupId>org.springframework.boot</groupId>',
    'services/python/requirements.txt': 'fastapi>=0.100\n',
    'services/python/main.py': 'print("ok")'
  })
  expect(graph.edges).toHaveLength(0)
  expect(scan.frameworks).toEqual(expect.arrayContaining(['Spring', 'fastapi']))
  expect(scan.packageManagers).toContain('pom.xml')
})
