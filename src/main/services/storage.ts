/**
 * Atomic, crash-safe file I/O used for Pi-Switch's own stores and by the
 * PiConfigService for Pi's native config.
 *
 * Write path: write temp file → fsync → rename over target. If the process
 * crashes mid-write, the original file is untouched.
 *
 * All FS is async (fs/promises). No fs.writeFileSync / execSync in hot paths.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { log } from './logger'

const writeQueues = new Map<string, Promise<void>>()

export async function fileMtime(p: string): Promise<number | null> {
  try {
    const st = await fs.stat(p)
    return Math.floor(st.mtimeMs)
  } catch {
    return null
  }
}

export async function readTextFile(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw err
  }
}

export async function readJsonFile<T>(p: string): Promise<T | null> {
  const text = await readTextFile(p)
  if (text === null) return null
  if (text.trim() === '') return null
  return JSON.parse(text) as T
}

/**
 * Atomic text write: temp sibling file → fsync → rename.
 * Ensures the destination is replaced atomically (same filesystem).
 */
async function writeAtomicText(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  let renamed = false
  try {
    // Flush through the same writable handle. Windows rejects fsync on the
    // read-only handle previously used here with EPERM.
    const handle = await fs.open(tmpPath, 'wx')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tmpPath, filePath)
    renamed = true
  } finally {
    if (!renamed) await fs.rm(tmpPath, { force: true }).catch(() => undefined)
  }
}

export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const queueKey = path.resolve(filePath)
  const previous = writeQueues.get(queueKey) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(() => writeAtomicText(filePath, content))
  writeQueues.set(queueKey, current)
  try {
    await current
  } finally {
    if (writeQueues.get(queueKey) === current) writeQueues.delete(queueKey)
  }
}

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const text = JSON.stringify(data, null, 2) + '\n'
  await atomicWriteText(filePath, text)
}

/**
 * A small cached JSON store for Pi-Switch app state (settings/metadata/ui-state).
 * Reads lazily, writes atomically, and never holds secrets in plaintext beyond
 * the process.
 */
export class JsonStore<T extends object> {
  private cache: T | null = null
  private loaded = false

  constructor(
    private readonly filePath: string,
    private readonly defaults: T
  ) {}

  async read(): Promise<T> {
    if (this.loaded && this.cache) return this.cache
    try {
      const data = await readJsonFile<T>(this.filePath)
      this.cache = data ? { ...this.defaults, ...data } : { ...this.defaults }
    } catch (err) {
      log.config.warn(`store read failed (${this.filePath}), using defaults:`, err)
      this.cache = { ...this.defaults }
    }
    this.loaded = true
    return this.cache
  }

  async write(next: T): Promise<void> {
    this.cache = next
    await atomicWriteJson(this.filePath, next)
  }

  async update(patch: Partial<T>): Promise<T> {
    const current = await this.read()
    const next = { ...current, ...patch }
    await this.write(next)
    return next
  }

  /** Sync peek — returns cache or defaults (never hits disk). */
  peek(): T {
    return this.cache ?? { ...this.defaults }
  }

  invalidate(): void {
    this.cache = null
    this.loaded = false
  }
}
