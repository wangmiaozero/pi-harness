// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectIntelligenceService } from './service'
import { ArchitectureSnapshots } from './snapshots'
import { ArchifyProvider, VIEWER_CSP } from './archify'
import { architectureTools } from './tools'
import { workspaceId } from './scanner'
import type { ArchitectureRendererProvider } from './archify'
import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent'

const directories: string[] = []
afterEach(async () => {
  for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})
async function fixture(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'architecture-')))
  directories.push(dir)
  return dir
}
async function setup(renderer?: ArchitectureRendererProvider) {
  const root = await fixture()
  const home = await fixture()
  const sibling = await fixture()
  await fs.writeFile(
    path.join(root, 'index.ts'),
    "import { value } from './value'\n// import fake from './fake'\n"
  )
  await fs.writeFile(path.join(root, 'value.ts'), 'export const value=1')
  await fs.writeFile(path.join(root, 'fake.ts'), 'export default false')
  const access = {
    assertAllowed: async (input: string, options: { mustExist?: boolean } = {}) => {
      const real = await fs.realpath(input).catch((error) => {
        if (options.mustExist === false) return path.resolve(input)
        throw error
      })
      if (![root, sibling].includes(real)) throw new Error('Unauthorized project')
      return real
    }
  }
  const store = new ArchitectureSnapshots(home)
  const provider =
    renderer ?? new ArchifyProvider(path.resolve('resources/archify'), path.join(home, 'temporary'))
  return {
    root,
    home,
    sibling,
    access,
    store,
    provider,
    service: new ProjectIntelligenceService(access, store, provider)
  }
}
async function finish(service: ProjectIntelligenceService, root: string) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const s = await service.status(root)
    if (['completed', 'failed', 'cancelled'].includes(s.phase)) return s
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('Analysis timeout')
}
describe('project intelligence and real Archify', () => {
  it('retries a failed overview from its saved index and keeps the recovered map after reopening', async () => {
    let failed = true
    const render = vi.fn(async () => {
      if (failed) throw new Error('render failed')
      return '<html><head></head><body>recovered-map</body></html>'
    })
    const f = await setup({ id: 'test', render })
    await f.service.analyze({ root: f.root })
    await finish(f.service, f.root)
    const snapshot = (await f.service.snapshot(f.root))!
    expect(snapshot.viewerUrl).toBeNull()
    failed = false
    // A retry renders the saved source index, even when the source is offline.
    await fs.rm(f.root, { recursive: true, force: true })
    const map = await f.service.map({ root: f.root, snapshotId: snapshot.graph.snapshotId })
    expect(render).toHaveBeenCalledTimes(2)
    expect(
      await f.service.viewArtifact(f.root, snapshot.graph.snapshotId, map.viewerUrl)
    ).toContain('recovered-map')
    await f.service.close()
    const reopened = new ProjectIntelligenceService(
      f.access,
      new ArchitectureSnapshots(f.home),
      f.provider
    )
    expect((await reopened.snapshot(f.root))!.viewerUrl).toBeTruthy()
    expect((await reopened.snapshot(f.root))!.graph).toEqual(snapshot.graph)
    expect(await reopened.history(f.root)).toHaveLength(1)
    await reopened.close()
  })
  it('supersedes a slow map projection and closes its renderer without touching snapshots', async () => {
    let slow = false
    let entered = 0
    const f = await setup({
      id: 'test',
      render: async (_graph, signal) => {
        if (slow && ++entered === 1)
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
          )
        return '<html><head></head><body>map</body></html>'
      }
    })
    await f.service.analyze({ root: f.root })
    await finish(f.service, f.root)
    const graph = (await f.service.snapshot(f.root))!.graph
    slow = true
    const input = { root: f.root, snapshotId: graph.snapshotId }
    const old = f.service.map({ ...input, moduleId: graph.nodes[0].id }).catch(() => 'cancelled')
    await vi.waitFor(() => expect(entered).toBe(1))
    const next = await f.service.map({ ...input, moduleId: graph.nodes[1].id })
    expect(await old).toBe('cancelled')
    expect(next.focus).toBe(graph.nodes[1].id)
    expect(await f.service.history(f.root)).toHaveLength(1)
    entered = 0
    const pending = f.service
      .map({ ...input, moduleId: graph.nodes[2].id })
      .catch(() => 'cancelled')
    await vi.waitFor(() => expect(entered).toBe(1))
    await f.service.close()
    expect(await pending).toBe('cancelled')
    expect(await f.service.viewer(next.viewerUrl)).toBeNull()
  })
  it('renders later map pages and module neighborhoods without scanning, model calls or replacing context', async () => {
    const render = vi.fn(async () => '<html><head></head><body>projection</body></html>')
    const f = await setup({ id: 'test', render })
    for (let i = 0; i < 55; i++)
      await fs.writeFile(
        path.join(f.root, `module-${String(i).padStart(2, '0')}.ts`),
        i === 54 ? "import '../outside'\nimport './value'" : 'export const value=1'
      )
    await f.service.analyze({ root: f.root })
    await finish(f.service, f.root)
    const snapshot = (await f.service.snapshot(f.root))!
    const late = snapshot.graph.nodes.find((n) => n.name === 'module-54.ts')!
    await fs.rm(f.root, { recursive: true, force: true }) // Maps and context remain usable offline.
    const input = { root: f.root, snapshotId: snapshot.graph.snapshotId }
    const page = await f.service.map({ ...input, offset: 48 })
    expect(page.moduleIds).toHaveLength(10)
    expect(page.moduleIds).toContain(late.id)
    const focus = await f.service.map({ ...input, moduleId: late.id })
    expect(focus.moduleIds).toHaveLength(2)
    expect(render.mock.calls).toHaveLength(3)
    expect(
      (
        render.mock.calls as unknown as Array<
          [import('@shared/intelligence/schema').ArchitectureGraph]
        >
      )[2][0].nodes[0].id
    ).toBe(late.id)
    expect(await f.service.query(f.root, 'get_project_architecture', {})).toMatchObject({
      nodeCount: 58
    })
    expect(await f.service.history(f.root)).toHaveLength(1)
    expect((await f.service.snapshot(f.root))!.graph.snapshotId).toBe(snapshot.graph.snapshotId)
    expect(
      await f.service.viewArtifact(f.root, snapshot.graph.snapshotId, focus.viewerUrl)
    ).toContain('projection')
    await expect(
      f.service.viewArtifact(f.sibling, snapshot.graph.snapshotId, focus.viewerUrl)
    ).rejects.toThrow('belong')
    await expect(f.service.map({ ...input, moduleId: 'n-0000000000000000' })).rejects.toThrow(
      'does not exist'
    )
    await f.service.clear(f.root)
    expect(await f.service.viewer(focus.viewerUrl)).toBeNull()
    await f.service.close()
  })
  it('renders upstream HTML offline, restores independent context and verifies source evidence', async () => {
    const f = await setup()
    await f.service.analyze({ root: f.root })
    expect((await finish(f.service, f.root)).phase).toBe('completed')
    const snapshot = await f.service.snapshot(f.root)
    if (!snapshot?.viewerUrl)
      await f.provider.render(snapshot!.graph, new AbortController().signal, 'en')
    expect(snapshot?.viewerUrl).toMatch(/^pi-architecture:/)
    const html = await f.service.artifact(f.root, snapshot!.graph.snapshotId, 'html')
    expect(html).toContain('data-node-id=')
    expect(html).toContain('Content-Security-Policy')
    expect(html).not.toMatch(/<script[^>]+src=/i)
    expect(VIEWER_CSP).toContain("connect-src 'none'")
    expect(snapshot?.graph.edges).toHaveLength(1)
    const node = snapshot!.graph.nodes.find((n) => n.name === 'index.ts')!
    expect(await f.service.source(f.root, snapshot!.graph.snapshotId, node.id, 'index.ts')).toEqual(
      { path: path.join(f.root, 'index.ts'), line: 1 }
    )
    const restored = new ProjectIntelligenceService(f.access, new ArchitectureSnapshots(f.home), {
      id: 'unavailable',
      render: async () => {
        throw new Error('Renderer replaced')
      }
    })
    expect(await restored.query(f.root, 'get_project_architecture', {})).toMatchObject({
      snapshotId: snapshot!.graph.snapshotId
    })
    expect(await restored.query(f.sibling, 'get_project_architecture', {})).toMatchObject({
      available: false
    })
    await expect(
      restored.query(f.root, 'search_project_modules', { workspaceId: workspaceId(f.sibling) })
    ).rejects.toThrow('current project')
    const tools = architectureTools(restored, f.root)
    expect(tools).toHaveLength(5)
    const result = await tools[1].execute(
      'call',
      { query: 'value' },
      undefined,
      undefined,
      {} as ExtensionToolContext
    )
    expect(JSON.parse((result.content[0] as { text: string }).text).modules).toHaveLength(1)
    const related = await restored.query(f.root, 'get_related_modules', {
      moduleId: node.id,
      direction: 'downstream',
      limit: 1
    })
    expect(related).toMatchObject({ total: 1 })
    expect(related).toMatchObject({
      relationships: snapshot!.graph.edges,
      relationshipCount: 1,
      relationshipsTruncated: false
    })
    const details = await tools[2].execute(
      'details',
      { moduleId: node.id },
      undefined,
      undefined,
      {} as ExtensionToolContext
    )
    expect(JSON.parse((details.content[0] as { text: string }).text)).toMatchObject({
      tool: 'get_module_details',
      relationships: snapshot!.graph.edges
    })
    await expect(
      restored.query(f.sibling, 'get_project_architecture', { workspaceId: workspaceId(f.root) })
    ).rejects.toThrow('current project')
    await fs.writeFile(path.join(f.root, 'index.ts'), 'changed')
    await expect(
      restored.source(f.root, snapshot!.graph.snapshotId, node.id, 'index.ts')
    ).rejects.toThrow('changed')
    const freshService = new ProjectIntelligenceService(f.access, f.store, f.provider)
    expect((await freshService.snapshot(f.root))?.staleness).toBe('stale')
    await f.service.close()
    await restored.close()
    await freshService.close()
    await fs.rm(f.root, { recursive: true, force: true })
    const offline = new ProjectIntelligenceService(f.access, f.store, f.provider)
    expect((await offline.snapshot(f.root))?.staleness).toBe('unknown')
    expect(await offline.query(f.root, 'get_project_architecture', {})).toMatchObject({
      snapshotId: snapshot!.graph.snapshotId
    })
    await expect(offline.analyze({ root: f.root })).rejects.toThrow()
    await offline.close()
  }, 20000)
  it('keeps context when rendering or optional model analysis fails and paginates it', async () => {
    const f = await setup({
      id: 'failed',
      version: '9.0.0',
      render: async () => {
        throw new Error('Unavailable')
      }
    })
    await f.service.analyze({ root: f.root, ai: true })
    await finish(f.service, f.root)
    const snap = await f.service.snapshot(f.root)
    expect(snap?.viewerUrl).toBeNull()
    expect(snap?.graph.revision).toMatchObject({
      archifyVersion: null,
      rendererProvider: 'failed',
      rendererVersion: '9.0.0'
    })
    expect(snap?.graph.warnings.join(' ')).toContain('AI analysis')
    const result = await f.service.query(f.root, 'search_project_modules', { limit: 1 })
    expect(result).toMatchObject({ nextOffset: 1, total: 3 })
    await expect(f.service.analyze({ root: f.home })).rejects.toThrow('Unauthorized')
    await expect(
      f.service.source(f.root, snap!.graph.snapshotId, snap!.graph.nodes[0].id, '../outside')
    ).rejects.toThrow()
    await f.service.close()
  })
  it('deduplicates and cancels work without overwriting the last successful snapshot', async () => {
    const f = await setup({
      id: 'fake',
      render: async () => '<html><head></head><body>test</body></html>'
    })
    await f.service.analyze({ root: f.root })
    await finish(f.service, f.root)
    const old = (await f.service.snapshot(f.root))!.graph.snapshotId
    let renders = 0
    const slow: ArchitectureRendererProvider = {
      id: 'waiting',
      render: async (_g, signal) => {
        renders++
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        )
        return ''
      }
    }
    const service = new ProjectIntelligenceService(f.access, f.store, slow)
    await service.analyze({ root: f.root })
    await service.analyze({ root: f.root })
    while ((await service.status(f.root)).phase !== 'rendering')
      await new Promise((r) => setTimeout(r, 10))
    await service.cancel(f.root)
    expect((await service.status(f.root)).phase).toBe('cancelled')
    expect(renders).toBe(1)
    expect((await service.snapshot(f.root))!.graph.snapshotId).toBe(old)
    let root: string | null = f.root
    const tool = architectureTools(service, () => root)[0]
    root = null
    await expect(
      tool.execute('call', {}, undefined, undefined, {} as ExtensionToolContext)
    ).rejects.toThrow('No project')
    await service.close()
    await f.service.close()
  })
  it('rolls back only the new snapshot when cancelled during the atomic save', async () => {
    let currentSignal: AbortSignal | undefined
    const f = await setup({
      id: 'test',
      render: async (_graph, signal) => {
        currentSignal = signal
        return ''
      }
    })
    await f.service.analyze({ root: f.root })
    await finish(f.service, f.root)
    const old = (await f.service.snapshot(f.root))!.graph.snapshotId
    const save = f.store.save.bind(f.store)
    let release: () => void = () => undefined
    let markReached!: () => void
    const reached = new Promise<void>((resolve) => {
      markReached = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(f.store, 'save').mockImplementation(async (graph, html) => {
      await save(graph, html)
      markReached()
      await gate
    })
    try {
      await f.service.analyze({ root: f.root })
      await reached
      const aborted = new Promise<void>((resolve) => {
        currentSignal!.addEventListener('abort', () => resolve(), { once: true })
      })
      const cancelled = f.service.cancel(f.root)
      await aborted
      release()
      await cancelled
      expect((await f.service.status(f.root)).phase).toBe('cancelled')
      expect((await f.service.history(f.root)).map((record) => record.snapshotId)).toEqual([old])
    } finally {
      release()
      await f.service.close()
    }
  })
  it('queues excess analyses, cancels waiting work and releases execution slots', async () => {
    const f = await setup()
    const third = await fixture()
    await fs.writeFile(path.join(f.sibling, 'main.ts'), 'export const sibling = true')
    await fs.writeFile(path.join(third, 'main.ts'), 'export const third = true')
    let renders = 0
    let active = 0
    let peak = 0
    const service = new ProjectIntelligenceService(
      {
        assertAllowed: async (root) => {
          if (![f.root, f.sibling, third].includes(root)) throw new Error('Unauthorized')
          return root
        }
      },
      f.store,
      {
        id: 'slow',
        render: async (_graph, signal) => {
          renders++
          active++
          peak = Math.max(peak, active)
          try {
            await new Promise<void>((_resolve, reject) =>
              signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
            )
            return ''
          } finally {
            active--
          }
        }
      }
    )
    await service.analyze({ root: f.root })
    await service.analyze({ root: f.sibling })
    await service.analyze({ root: third })
    await vi.waitFor(() => expect(renders).toBe(2))
    expect(await service.status(third)).toMatchObject({ phase: 'preparing', waiting: true })
    await service.cancel(third)
    expect((await service.status(third)).phase).toBe('cancelled')
    expect(renders).toBe(2)
    await service.cancel(f.root)
    await service.analyze({ root: third })
    await vi.waitFor(() => expect(renders).toBe(3))
    expect(peak).toBe(2)
    await service.close()
    await f.service.close()
    expect(active).toBe(0)
  })
})
