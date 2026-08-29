import { watch, type FSWatcher } from 'chokidar'
import path from 'node:path'
import { isIgnoredWorkspaceDirectoryName } from '@shared/workspace/search-ignore'

export class WorkspaceWatcherService {
  private watchers = new Map<string, FSWatcher>()
  private pending = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private listener: ((roots: string[]) => void) | null = null

  onChange(listener: ((roots: string[]) => void) | null): void {
    this.listener = listener
  }

  async sync(roots: string[]): Promise<void> {
    const next = new Set(roots.filter(Boolean))
    await Promise.all(
      [...this.watchers.entries()].map(async ([root, watcher]) => {
        if (next.has(root)) return
        await watcher.close().catch(() => undefined)
        this.watchers.delete(root)
      })
    )
    for (const root of next) {
      if (this.watchers.has(root)) continue
      const watcher = watch(root, {
        ignoreInitial: true,
        ignored: (watchPath) => this.shouldIgnore(root, watchPath),
        ignorePermissionErrors: true,
        depth: 12,
        awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 }
      })
      watcher.on('all', () => this.queue(root))
      this.watchers.set(root, watcher)
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
    await Promise.all([...this.watchers.values()].map((watcher) => watcher.close().catch(() => undefined)))
    this.watchers.clear()
  }

  private shouldIgnore(root: string, watchPath: string): boolean {
    const relative = path.relative(root, watchPath)
    if (!relative || relative.startsWith('..')) return false
    return relative.split(path.sep).some((segment) => isIgnoredWorkspaceDirectoryName(segment))
  }

  private queue(root: string): void {
    this.pending.add(root)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      const roots = [...this.pending]
      this.pending.clear()
      this.timer = null
      this.listener?.(roots)
    }, 200)
  }
}
