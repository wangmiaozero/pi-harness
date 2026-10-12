import fs from 'node:fs/promises'
import path from 'node:path'
import { architectureGraphSchema, type ArchitectureGraph } from '@shared/intelligence/schema'
import { atomicWriteText } from '../services/storage'
import { hash } from './scanner'

export class ArchitectureSnapshots {
  private damaged = new Set<string>()
  constructor(private readonly home: string) {}
  private directory(id: string): string {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid project identity')
    return path.join(this.home, id)
  }
  async save(graph: ArchitectureGraph, html: string | null): Promise<void> {
    architectureGraphSchema.parse(graph)
    const json = JSON.stringify(graph)
    // One atomic record commits graph, index source and optional artifact together.
    await atomicWriteText(
      path.join(this.directory(graph.workspaceId), `${graph.snapshotId}.json`),
      JSON.stringify({ schemaVersion: 1, checksum: hash(json), json, html })
    )
  }
  async list(id: string): Promise<ArchitectureGraph[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.directory(id))
    } catch {
      return []
    }
    const graphs: ArchitectureGraph[] = []
    this.damaged.delete(id)
    for (const name of names.filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))) {
      const record = await this.load(id, name.slice(0, -5)).catch(() => {
        this.damaged.add(id)
        return null
      })
      if (record) graphs.push(record.graph)
    }
    return graphs.sort((a, b) => b.revision.createdAt.localeCompare(a.revision.createdAt))
  }
  async load(
    id: string,
    snapshotId?: string
  ): Promise<{ graph: ArchitectureGraph; html: string | null } | null> {
    if (!snapshotId) {
      const graphs = await this.list(id)
      return graphs[0] ? this.load(id, graphs[0].snapshotId) : null
    }
    if (!/^[a-f0-9-]{36}$/.test(snapshotId)) throw new Error('Invalid snapshot identity')
    const file = path.join(this.directory(id), `${snapshotId}.json`)
    try {
      const st = await fs.stat(file)
      if (st.size > 8_000_000) throw new Error('Snapshot exceeds limit')
      const record = JSON.parse(await fs.readFile(file, 'utf8')) as {
        schemaVersion: unknown
        checksum: unknown
        json: string
        html: string | null
      }
      if (
        record.schemaVersion !== 1 ||
        typeof record.json !== 'string' ||
        hash(record.json) !== record.checksum ||
        (record.html !== null && typeof record.html !== 'string')
      )
        throw new Error('Snapshot is corrupt')
      const graph = architectureGraphSchema.parse(JSON.parse(record.json))
      if (graph.workspaceId !== id || graph.snapshotId !== snapshotId)
        throw new Error('Snapshot identity mismatch')
      return { graph, html: record.html }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }
  async clear(id: string): Promise<void> {
    await fs.rm(this.directory(id), { recursive: true, force: true })
  }
  async remove(id: string, snapshotId: string): Promise<void> {
    if (!/^[a-f0-9-]{36}$/.test(snapshotId)) throw new Error('Invalid snapshot identity')
    await fs.rm(path.join(this.directory(id), `${snapshotId}.json`), { force: true })
  }
  hasDamagedSnapshots(id: string): boolean {
    return this.damaged.has(id)
  }
}
