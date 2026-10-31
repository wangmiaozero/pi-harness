import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ConfigConflictError } from './errors'

/** Writers fail fast; consistent readers can wait briefly. Only dead owners can be reclaimed. */
export async function withFileLease<T>(
  target: string,
  operation: () => Promise<T>,
  recoveryKey?: string,
  options: { waitMs?: number } = {}
): Promise<T> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const parent = await fs.realpath(path.dirname(target))
  const lock = path.join(parent, `.${path.basename(target)}.harness-lock`)
  // Publish a complete owner record with an exclusive hard link. A crash while
  // preparing metadata leaves only an unreferenced staging file, never an empty lock.
  const staged = `${lock}.${process.pid}.${randomUUID()}.owner`
  const metadata = await fs.open(staged, 'wx', 0o600)
  try {
    await metadata.writeFile(
      JSON.stringify({ pid: process.pid, ...(recoveryKey ? { recoveryKey } : {}) })
    )
    await metadata.sync()
  } finally {
    await metadata.close()
  }
  try {
    const deadline = Date.now() + Math.max(0, Math.min(options.waitMs ?? 0, 2000))
    let reclaimed = false
    for (;;) {
      try {
        await fs.link(staged, lock)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (!reclaimed && (await reclaimDeadOwner(lock, recoveryKey))) {
          reclaimed = true
          continue
        }
        if (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(25, deadline - Date.now())))
          continue
        }
        throw new ConfigConflictError(
          'Another or interrupted writer owns this file. Close other instances; if a restore was interrupted, reopen its Backups page and restore it again.'
        )
      }
      try {
        return await operation()
      } finally {
        await fs.unlink(lock)
      }
    }
  } finally {
    await fs.unlink(staged)
  }
}

async function reclaimDeadOwner(lock: string, recoveryKey?: string): Promise<boolean> {
  const guard = `${lock}.reclaim`
  try {
    await fs.mkdir(guard)
  } catch {
    return false
  }
  try {
    const owner = JSON.parse(await fs.readFile(lock, 'utf8')) as {
      pid?: unknown
      recoveryKey?: unknown
    }
    // A crashed restore must be resumed explicitly by its originating profile.
    if (owner.recoveryKey !== undefined && owner.recoveryKey !== recoveryKey) return false
    if (!Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0) return false
    try {
      process.kill(Number(owner.pid), 0)
      return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false
    }
    await fs.unlink(lock)
    return true
  } catch {
    return false
  } finally {
    await fs.rmdir(guard)
  }
}
