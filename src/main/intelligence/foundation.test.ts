import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { architectureGraphSchema, relativeSourceSchema } from '@shared/intelligence/schema'
import { scanProject, safeSource, workspaceId } from './scanner'
import { extractGraph } from './graph'
import { ArchitectureSnapshots } from './snapshots'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
async function fixture(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'intelligence-')))
  roots.push(root)
  return root
}
describe('verified architecture foundation', () => {
  it('respects nested ignores, secrets, symlinks, binary and size limits', async () => {
    const root = await fixture()
    const outside = await fixture()
    await fs.mkdir(path.join(root, 'src'))
    await fs.writeFile(path.join(root, '.gitignore'), 'hidden.ts\n')
    await fs.writeFile(path.join(root, 'src', '.gitignore'), 'ignored.ts\n')
    for (const f of ['hidden.ts', 'src/ignored.ts', '.env', 'secrets.json'])
      await fs.writeFile(path.join(root, f), 'secret')
    await fs.writeFile(path.join(root, 'main.ts'), "import { value } from './src/value'\n")
    await fs.writeFile(path.join(root, 'src/value.ts'), 'export const value = 1')
    await fs.writeFile(path.join(root, 'binary.ts'), Buffer.from([0, 1, 2]))
    await fs.writeFile(path.join(root, 'large.ts'), 'x'.repeat(128_001))
    if (process.platform !== 'win32') await fs.symlink(outside, path.join(root, 'escape'))
    const scan = await scanProject(root, new AbortController().signal)
    expect(scan.files.map((f) => f.path)).toEqual(['main.ts', 'src/value.ts'])
    expect(scan.languages).toEqual(['TypeScript'])
    const graph = extractGraph(root, scan)
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].sourceReferences[0].startLine).toBe(1)
    await expect(safeSource(root, '../else.ts')).rejects.toThrow()
    expect(relativeSourceSchema.safeParse('C:/outside.ts').success).toBe(false)
    expect(workspaceId(root)).not.toBe(workspaceId(outside))
    expect(
      architectureGraphSchema.safeParse({
        ...graph,
        edges: [{ ...graph.edges[0], target: 'missing' }]
      }).success
    ).toBe(false)
  })
  it('round trips atomic snapshots and rejects corruption without losing earlier success', async () => {
    const root = await fixture()
    const home = await fixture()
    await fs.writeFile(path.join(root, 'main.py'), 'print("hello")')
    const graph = extractGraph(root, await scanProject(root, new AbortController().signal))
    const store = new ArchitectureSnapshots(home)
    await store.save(graph, '<html>offline</html>')
    expect((await new ArchitectureSnapshots(home).load(graph.workspaceId))?.graph).toEqual(graph)
    const second = { ...graph, snapshotId: '00000000-0000-4000-8000-000000000000' }
    await store.save(second, null)
    await fs.writeFile(path.join(home, graph.workspaceId, `${second.snapshotId}.json`), 'broken')
    await expect(store.load(graph.workspaceId, second.snapshotId)).rejects.toThrow()
    expect(await store.list(graph.workspaceId)).toEqual([graph])
    await fs.writeFile(path.join(root, 'main.py'), 'print("changed")')
    expect((await scanProject(root, new AbortController().signal)).fingerprint).not.toBe(
      graph.revision.fingerprint
    )
  })
  it('restores earlier v1 snapshots without package metadata', async () => {
    const root = await fixture()
    const home = await fixture()
    await fs.writeFile(path.join(root, 'main.ts'), 'export const value=1')
    const graph = extractGraph(root, await scanProject(root, new AbortController().signal))
    const legacy = JSON.parse(JSON.stringify(graph))
    delete legacy.project.packages
    for (const node of legacy.nodes) delete node.packageManifest
    const store = new ArchitectureSnapshots(home)
    await store.save(legacy, null)
    expect((await store.load(graph.workspaceId))!.graph.project.packages).toEqual([])
  })
  it('aborts scanning and honors user exclusions', async () => {
    const root = await fixture()
    await fs.writeFile(path.join(root, 'one.go'), 'package main')
    expect((await scanProject(root, new AbortController().signal, ['one.go'])).files).toHaveLength(
      0
    )
    const controller = new AbortController()
    controller.abort()
    await expect(scanProject(root, controller.signal)).rejects.toThrow()
  })
  it('honors nested negation and isolates projects with the same display name', async () => {
    const parent = await fixture()
    const other = await fixture()
    const root = path.join(parent, 'shared')
    const second = path.join(other, 'shared')
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(second)
    await fs.writeFile(path.join(root, '.gitignore'), '*.ts\n')
    await fs.writeFile(path.join(root, 'src', '.gitignore'), '!keep.ts\n')
    await fs.writeFile(path.join(root, 'src', 'keep.ts'), 'export const keep=true')
    expect(
      (await scanProject(root, new AbortController().signal)).files.map((f) => f.path)
    ).toEqual(['src/keep.ts'])
    expect(workspaceId(root)).not.toBe(workspaceId(second))
  })
  it('bounds large projects and stops an in-progress scan', async () => {
    const root = await fixture()
    for (let i = 0; i < 410; i++)
      await fs.writeFile(path.join(root, `module-${i}.ts`), 'export const moduleValue = 1')
    const limited = await scanProject(root, new AbortController().signal)
    expect(limited.files).toHaveLength(400)
    expect(limited.coverage.partial).toBe(true)
    const controller = new AbortController()
    let count = 0
    await expect(
      scanProject(root, controller.signal, [], (files) => {
        count = files
        if (files === 3) controller.abort()
      })
    ).rejects.toThrow()
    expect(count).toBe(3)
  })
})
