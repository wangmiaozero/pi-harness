import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, unlink } from 'node:fs/promises'
import type { JsonStore } from '../../services/storage'
import type { FileService } from '../../files/file-service'
import { FileConflictError, ValidationError } from '../../services/errors'
import type { RunFileUndoStatus } from '@shared/types/harness'

interface Snapshot {
  path: string
  before: string | null
  after: string
  undone?: boolean
}
interface UndoRun {
  sessionId: string
  runId: string
  sealed: boolean
  unsupported: boolean
  files: Snapshot[]
}
export interface FileUndoRecord {
  runs: UndoRun[]
}
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_RUN_BYTES = 4 * 1024 * 1024
const MAX_STORE_BYTES = 8 * 1024 * 1024

/** Private recovery data, separate from redacted artifact previews and Pi history. */
export class FileUndoService {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly store: JsonStore<FileUndoRecord>,
    private readonly files: FileService,
    private readonly authorize: (sessionId: string, target: string) => Promise<string>
  ) {}
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(operation)
    this.queue = next
    return next
  }
  async capture(
    sessionId: string,
    runId: string,
    target: string,
    tool: string,
    input: Record<string, unknown>
  ): Promise<void> {
    await this.exclusive(async () => {
      const record = await this.store.read()
      let run = record.runs.find((item) => item.runId === runId && item.sessionId === sessionId)
      if (!run) {
        run = { sessionId, runId, sealed: false, unsupported: false, files: [] }
        record.runs.unshift(run)
      }
      if (run.unsupported || run.sealed) return
      try {
        const file = await this.authorize(sessionId, target)
        const before = await this.read(file, true)
        const previous = run.files.find((item) => item.path === file)
        if (previous && previous.after !== before) throw new Error('Concurrent change')
        let after: string
        if (tool === 'write' && typeof input.content === 'string') after = input.content
        else if (
          tool === 'edit' &&
          before !== null &&
          typeof input.oldText === 'string' &&
          typeof input.newText === 'string' &&
          input.oldText.length &&
          before.split(input.oldText).length === 2
        )
          after = before.replace(input.oldText, input.newText)
        else throw new Error('No exact restoration evidence')
        if (Buffer.byteLength(after) > MAX_FILE_BYTES) throw new Error('Snapshot too large')
        if (previous) previous.after = after
        else run.files.push({ path: file, before, after })
        const bytes = run.files.reduce(
          (sum, item) => sum + Buffer.byteLength(item.before ?? '') + Buffer.byteLength(item.after),
          0
        )
        if (bytes > MAX_RUN_BYTES) throw new Error('Snapshot limit')
      } catch {
        run.unsupported = true
        run.files = []
      }
      const size = (item: UndoRun) =>
        item.files.reduce(
          (sum, file) => sum + Buffer.byteLength(file.before ?? '') + Buffer.byteLength(file.after),
          0
        )
      while (
        record.runs.length > 32 ||
        record.runs.reduce((sum, item) => sum + size(item), 0) > MAX_STORE_BYTES
      ) {
        let index = record.runs.length - 1
        while (index >= 0 && (!record.runs[index].sealed || record.runs[index] === run)) index--
        if (index < 0) {
          run.unsupported = true
          run.files = []
          break
        }
        record.runs.splice(index, 1)
      }
      await this.store.write(record)
    })
  }
  async seal(sessionId: string, runId: string): Promise<void> {
    await this.exclusive(async () => {
      const record = await this.store.read()
      const run = record.runs.find((item) => item.runId === runId && item.sessionId === sessionId)
      if (!run || run.sealed) return
      try {
        for (const file of run.files) {
          await this.authorize(sessionId, file.path)
          if ((await this.read(file.path)) !== file.after) throw new Error('Unverified tool result')
        }
      } catch {
        run.unsupported = true
        run.files = []
      }
      run.sealed = true
      await this.store.write(record)
    })
  }
  async status(sessionId: string, runId: string): Promise<RunFileUndoStatus> {
    await this.queue.catch(() => undefined)
    const run = (await this.store.read()).runs.find(
      (item) => item.runId === runId && item.sessionId === sessionId
    )
    const remaining = run?.files.filter((file) => !file.undone).length ?? 0
    return {
      available: Boolean(run?.sealed && !run.unsupported && remaining),
      undone: Boolean(run?.files.length && !remaining),
      fileCount: run?.files.length ?? 0,
      remainingCount: remaining
    }
  }
  async undo(sessionId: string, runId: string): Promise<RunFileUndoStatus> {
    await this.exclusive(async () => {
      const record = await this.store.read()
      const run = record.runs.find((item) => item.runId === runId && item.sessionId === sessionId)
      if (!run?.sealed || run.unsupported || !run.files.length)
        throw new ValidationError('No verified file snapshots are available for this turn')
      const pending = run.files.filter((file) => !file.undone)
      // Validate every target before the first mutation. Never fall back to Git HEAD.
      for (const file of pending) {
        await this.authorize(sessionId, file.path)
        if ((await this.read(file.path)) !== file.after)
          throw new FileConflictError('A file changed after this turn; undo was cancelled')
      }
      for (const file of pending) {
        await this.authorize(sessionId, file.path)
        if (file.before === null) {
          if ((await this.read(file.path)) !== file.after)
            throw new FileConflictError('A new file changed after this turn; undo was cancelled')
          await unlink(file.path)
        } else {
          const revision = createHash('sha256').update(file.after).digest('hex')
          await this.files.writeText(file.path, file.before, revision)
        }
        file.undone = true
        // Keep progress recoverable if a later file hits an I/O error.
        await this.store.write(record)
      }
    })
    return this.status(sessionId, runId)
  }
  private async read(file: string, missing = false): Promise<string | null> {
    try {
      const stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES)
        throw new ValidationError('Unsupported undo file')
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const opened = await handle.stat()
        if (!opened.isFile() || opened.size > MAX_FILE_BYTES)
          throw new ValidationError('Unsupported undo file')
        const bytes = await handle.readFile()
        const text = bytes.toString('utf8')
        if (bytes.length > MAX_FILE_BYTES || bytes.includes(0) || !Buffer.from(text).equals(bytes))
          throw new ValidationError('Undo requires UTF-8 text')
        return text
      } finally {
        await handle.close()
      }
    } catch (error) {
      if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
}
