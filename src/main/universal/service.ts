import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { watch, type FSWatcher } from 'chokidar'
import {
  universalIndexSchema,
  universalMessageSchema,
  universalQuerySchema,
  universalReadSchema,
  type UniversalIndex,
  type UniversalQuery,
  type UniversalSession,
  type SourceLocation,
  type UniversalSyncStatus,
  type UniversalMessage,
  type SourceProvider
} from '@shared/universal/schema'
import { atomicWriteJson, readJsonFile } from '../services/storage'
import { ValidationError, NotFoundError } from '../services/errors'
import { defaultSources, existingSources, contained } from './sources'
import type { ScanRequest, ScanResult } from './scanner'

const initialStatus = (): UniversalSyncStatus => ({
  running: false,
  cancelled: false,
  scanned: 0,
  changed: 0,
  errors: []
})
type Runner = (
  request: ScanRequest,
  progress: (status: UniversalSyncStatus) => void
) => Promise<ScanResult>
export class UniversalSessionService {
  private index: UniversalIndex = {
    schemaVersion: 1,
    sources: [],
    sessions: [],
    watch: false,
    status: initialStatus()
  }
  private ready: Promise<void> | null = null
  private syncing: Promise<UniversalSyncStatus> | null = null
  private worker: Worker | null = null
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private periodic: ReturnType<typeof setInterval> | null = null
  private cancelled = false
  private closed = false

  constructor(
    readonly root: string,
    private readonly candidates = defaultSources(),
    private readonly runner?: Runner
  ) {}
  async initialize(): Promise<void> {
    this.ready ??= (async () => {
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 })
      const stored = await readJsonFile<unknown>(path.join(this.root, 'index.json'))
      if (stored) {
        const parsed = universalIndexSchema.safeParse(stored)
        if (!parsed.success)
          throw new ValidationError(
            'The session index version is unsupported. Clear the local index to rebuild it.'
          )
        this.index = parsed.data
        this.index.status.running = false
      }
      if (this.index.watch) await this.restartWatcher()
      await fs.rm(path.join(this.root, 'snapshots'), { recursive: true, force: true })
      await this.prune()
      this.periodic = setInterval(() => {
        if (!this.closed && this.index.status.lastSync) void this.sync().catch(() => undefined)
      }, 5 * 60_000)
      this.periodic.unref()
    })()
    return this.ready
  }
  private save(): Promise<void> {
    return atomicWriteJson(
      path.join(this.root, 'index.json'),
      universalIndexSchema.parse(this.index)
    )
  }
  async sources(): Promise<SourceLocation[]> {
    await this.initialize()
    return existingSources([...this.candidates, ...this.index.sources])
  }
  /** Called only with a Main-owned native directory picker result. */
  async addSource(provider: SourceProvider, chosenRoot: string): Promise<SourceLocation> {
    await this.initialize()
    const root = await fs.realpath(chosenRoot)
    if (
      !(await fs.stat(root)).isDirectory() ||
      contained(root, this.root) ||
      contained(this.root, root)
    )
      throw new ValidationError('Choose a session directory outside the application cache.')
    const location: SourceLocation = { provider, root, custom: true }
    if (!this.index.sources.some((s) => s.provider === provider && s.root === root)) {
      this.index.sources.push(location)
      await this.save()
      if (this.index.watch) await this.restartWatcher()
    }
    return location
  }
  async status(): Promise<UniversalSyncStatus> {
    await this.initialize()
    return { ...structuredClone(this.index.status), watchEnabled: this.index.watch }
  }
  async sync(): Promise<UniversalSyncStatus> {
    await this.initialize()
    if (this.syncing) return this.syncing
    this.cancelled = false
    this.index.status = { ...initialStatus(), running: true, lastSync: this.index.status.lastSync }
    this.syncing = (async () => {
      const discovered = await this.sources()
      // Include previous roots so disappearance has a visible status rather than erasing history.
      const sources = [...discovered]
      for (const session of this.index.sessions)
        if (!sources.some((s) => s.root === session.source.root && s.provider === session.provider))
          sources.push({ provider: session.provider, root: session.source.root, custom: false })
      const request: ScanRequest = { sources, previous: this.index.sessions, storeRoot: this.root }
      try {
        const result = await (this.runner
          ? this.runner(request, (status) => {
              this.index.status = status
            })
          : this.runWorker(request))
        if (!this.cancelled && !this.closed) {
          const mappings = new Map(this.index.sessions.map((s) => [s.id, s.workspacePath]))
          this.index.sessions = result.sessions.map((s) => ({
            ...s,
            workspacePath: mappings.get(s.id) ?? s.workspacePath
          }))
          this.index.status = result.status
          await this.save()
        }
      } catch {
        if (!this.cancelled)
          this.index.status.errors.push({ provider: 'pi', code: 'SYNC_WORKER_FAILED' })
      } finally {
        await fs
          .rm(path.join(this.root, 'snapshots'), { recursive: true, force: true })
          .catch(() => undefined)
        this.index.status.running = false
        this.index.status.cancelled = this.cancelled
        this.worker = null
        this.syncing = null
      }
      return structuredClone(this.index.status)
    })()
    return this.syncing
  }
  private runWorker(request: ScanRequest): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'universal-worker.js'), {
        workerData: request
      })
      this.worker = worker
      let finished = false
      worker.on('message', (message) => {
        if (message.type === 'progress') this.index.status = message.status
        else if (message.type === 'complete') {
          finished = true
          resolve(message.result as ScanResult)
        } else if (message.type === 'error') {
          finished = true
          reject(new Error(message.code))
        }
      })
      worker.once('error', reject)
      worker.once('exit', () => {
        if (!finished) reject(new Error('SYNC_WORKER_STOPPED'))
      })
    })
  }
  async cancelSync(): Promise<void> {
    this.cancelled = true
    await this.worker?.terminate()
    await this.syncing
  }
  async list(
    input: UniversalQuery = {}
  ): Promise<{ sessions: UniversalSession[]; total: number; projects: string[] }> {
    await this.initialize()
    const q = universalQuerySchema.parse(input)
    const filtered: UniversalSession[] = []
    for (const session of this.index.sessions) {
      if (q.provider && session.provider !== q.provider) continue
      if (
        q.projectPath &&
        session.projectPath !== q.projectPath &&
        session.workspacePath !== q.projectPath
      )
        continue
      if ((q.after && session.updatedAt < q.after) || (q.before && session.updatedAt > q.before))
        continue
      if (q.query) {
        const query = q.query.toLowerCase()
        if (
          !`${session.title}\n${session.projectPath ?? ''}`.toLowerCase().includes(query) &&
          !(await this.searchBlob(session.blob, query))
        )
          continue
      }
      filtered.push(session)
    }
    filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const projects = [
      ...new Set(
        this.index.sessions.flatMap((s) =>
          [s.projectPath, s.workspacePath].filter((p): p is string => Boolean(p))
        )
      )
    ].sort()
    return {
      sessions: filtered.slice(q.offset, q.offset + q.limit),
      total: filtered.length,
      projects
    }
  }
  private async searchBlob(blob: string, query: string): Promise<boolean> {
    const stream = createReadStream(path.join(this.root, 'search', `${blob}.txt`), {
      encoding: 'utf8'
    })
    let tail = ''
    try {
      for await (const chunk of stream) {
        const text = tail + chunk
        if (text.includes(query)) return true
        tail = query.length > 1 ? text.slice(-(query.length - 1)) : ''
      }
      return false
    } catch {
      return false
    } finally {
      stream.destroy()
    }
  }
  async get(id: string): Promise<UniversalSession> {
    await this.initialize()
    const session = this.index.sessions.find((s) => s.id === id)
    if (!session) throw new NotFoundError('History session not found.')
    return structuredClone(session)
  }
  async read(input: {
    id: string
    offset?: number
    limit?: number
  }): Promise<{ session: UniversalSession; messages: UniversalMessage[]; total: number }> {
    const { id, offset, limit } = universalReadSchema.parse(input)
    const session = await this.get(id)
    const messages: UniversalMessage[] = []
    const stream = createReadStream(path.join(this.root, 'messages', `${session.blob}.jsonl`), {
      encoding: 'utf8'
    })
    const lines = createInterface({ input: stream, crlfDelay: Infinity })
    let index = 0
    try {
      for await (const line of lines) {
        if (!line) continue
        if (index++ < offset) continue
        messages.push(universalMessageSchema.parse(JSON.parse(line)))
        if (messages.length >= limit) break
      }
    } finally {
      lines.close()
      stream.destroy()
    }
    return { session, messages, total: session.messageCount }
  }
  async map(id: string, workspacePath: string): Promise<UniversalSession> {
    const session = await this.get(id)
    session.workspacePath = workspacePath
    this.index.sessions = this.index.sessions.map((s) => (s.id === id ? session : s))
    await this.save()
    return session
  }
  async forget(id: string): Promise<void> {
    await this.initialize()
    await this.cancelSync()
    this.index.sessions = this.index.sessions.filter((s) => s.id !== id)
    await this.save()
    await this.prune()
  }
  async clear(): Promise<void> {
    // The exact application-owned cache is the sole deletion target; sources are never touched.
    await this.cancelSync()
    this.index.sessions = []
    this.index.status = initialStatus()
    this.ready = Promise.resolve()
    await this.save()
    await this.prune()
  }
  async prune(): Promise<void> {
    const live = new Set(this.index.sessions.map((s) => s.blob))
    for (const dir of ['messages', 'search']) {
      const location = path.join(this.root, dir)
      for (const file of await fs.readdir(location).catch(() => [] as string[])) {
        if (
          (/^[a-f0-9]{64}\.(?:jsonl|txt)$/.test(file) && !live.has(file.split('.')[0]!)) ||
          /^\.[a-f0-9]{64}\.(?:jsonl|txt)\.\d+\.[\w-]+\.tmp$/.test(file)
        )
          await fs.unlink(path.join(location, file))
      }
    }
  }
  async setWatch(enabled: boolean): Promise<void> {
    await this.initialize()
    this.index.watch = enabled
    await this.save()
    await this.restartWatcher()
  }
  private async restartWatcher(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
    if (!this.index.watch || this.closed) return
    const sources = await existingSources([...this.candidates, ...this.index.sources])
    this.watcher = watch(
      sources.map((s) => s.root),
      {
        ignoreInitial: true,
        followSymlinks: false,
        depth: 12,
        awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 }
      }
    )
    this.watcher.on('all', () => {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        void this.sync().catch(() => undefined)
      }, 2500)
    })
    this.watcher.on('error', () => {
      this.index.status.errors.push({ provider: 'pi', code: 'SOURCE_WATCH_ERROR' })
    })
  }
  async close(): Promise<void> {
    this.closed = true
    if (this.periodic) clearInterval(this.periodic)
    if (this.timer) clearTimeout(this.timer)
    await this.cancelSync()
    await this.watcher?.close()
  }
}
