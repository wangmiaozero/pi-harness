import fs from 'node:fs/promises'
import ignore, { type Ignore } from 'ignore'
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
      const excluded = await this.directoryIgnores(root)
      const watcher = watch(root, {
        ignoreInitial: true,
        ignored: (watchPath, stat) =>
          this.shouldIgnore(root, watchPath) ||
          this.isGitIgnored(root, watchPath, stat?.isDirectory(), excluded),
        ignorePermissionErrors: true,
        followSymlinks: false,
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
    await Promise.all(
      [...this.watchers.values()].map((watcher) => watcher.close().catch(() => undefined))
    )
    this.watchers.clear()
  }

  private async directoryIgnores(root: string): Promise<Ignore> {
    const rules = ignore()
    try {
      const file = path.join(root, '.gitignore')
      const stat = await fs.lstat(file)
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 64_000)
        rules.add(await fs.readFile(file, 'utf8'))
    } catch {
      /* A workspace does not need a .gitignore. */
    }
    return rules
  }

  private isGitIgnored(
    root: string,
    watchPath: string,
    directory: boolean | undefined,
    rules: Ignore
  ): boolean {
    const relative = path.relative(root, watchPath).split(path.sep).join('/')
    if (!relative || relative === '..' || relative.startsWith('../')) return false
    return rules.ignores(relative + (directory !== false ? '/' : ''))
  }

  private shouldIgnore(root: string, watchPath: string): boolean {
    const relative = path.relative(root, watchPath)
    if (!relative || relative.startsWith('..')) return false
    const segments = relative.split(path.sep)
    // Nested agent checkouts and local Go build caches can exhaust native
    // macOS watchers. An explicitly opened checkout is still watched normally.
    return segments.some(
      (segment, index) =>
        isIgnoredWorkspaceDirectoryName(segment) ||
        segment === '.gocache' ||
        segment === '.gotmp' ||
        segment === '.worktrees' ||
        (segment === 'worktrees' &&
          (segments[index - 1] === '.claude' || segments[index - 1] === '.codex'))
    )
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
