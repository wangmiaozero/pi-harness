import fs from 'node:fs/promises'
import type { Stats } from 'node:fs'
import ignore, { type Ignore } from 'ignore'
import { watch } from 'chokidar'
import path from 'node:path'
import { homedir } from 'node:os'
import { isIgnoredWorkspaceDirectoryName } from '@shared/workspace/search-ignore'
import { log } from '../services/logger'
import { watchNativeWorkspace } from './native-workspace-watcher'

interface RootWatcher {
  close(): Promise<void>
  ready: Promise<void>
}

interface WatcherOptions {
  homeDirectory?: string
  excludedDirectories?: string[]
}

export class WorkspaceWatcherService {
  private watchers = new Map<string, RootWatcher>()
  private pending = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private listener: ((roots: string[]) => void) | null = null

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly options: WatcherOptions = {}
  ) {}

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
      // Home (or a drive/filesystem root above it) is a valid agent cwd, but
      // recursively subscribing to it can exhaust handles before ready fires.
      const canonical = async (file: string) => fs.realpath(file).catch(() => path.resolve(file))
      const [resolvedRoot, home, excludedRoots] = await Promise.all([
        canonical(root),
        canonical(this.options.homeDirectory ?? homedir()),
        Promise.all((this.options.excludedDirectories ?? []).map(canonical))
      ])
      const shallow = this.contains(resolvedRoot, home)
      // Explicitly opened workspaces inside userData (including the default
      // scratch workspace) remain live; ancestor workspaces must not watch state.
      const excludedDirectories = excludedRoots.filter((file) => !this.contains(file, resolvedRoot))
      const shouldIgnore = (file: string) => {
        const relative = path.relative(root, file)
        const resolvedFile = path.resolve(resolvedRoot, relative)
        return (
          (shallow && relative.split(path.sep).length > 1) ||
          excludedDirectories.some((directory) => this.contains(directory, resolvedFile)) ||
          this.shouldIgnore(root, file)
        )
      }
      const excluded = await this.directoryIgnores(root)
      const failed = (error: unknown) =>
        log.session.warn('Workspace file watcher failed', {
          code:
            error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
              ? error.code
              : 'WATCH_ERROR'
        })
      if (this.platform === 'darwin') {
        const watcher = watchNativeWorkspace(
          root,
          (file, directory) =>
            shouldIgnore(file) || this.isGitIgnored(root, file, directory, excluded),
          () => this.queue(root),
          failed,
          !shallow
        )
        this.watchers.set(root, watcher)
        try {
          await watcher.ready
        } catch (error) {
          this.watchers.delete(root)
          await watcher.close()
          throw error
        }
        continue
      }
      let initialized = false
      const initialFiles = new Map<string, string>()
      const fingerprint = (stat: Stats): string =>
        `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.mode}`
      const watcher = watch(root, {
        ignoreInitial: true,
        ignored: (watchPath, stat) => {
          const ignored =
            (path.resolve(watchPath) !== path.resolve(root) && stat?.isSymbolicLink()) ||
            shouldIgnore(watchPath) ||
            this.isGitIgnored(root, watchPath, stat?.isDirectory(), excluded)
          if (!ignored && !initialized && stat?.isFile())
            initialFiles.set(path.resolve(watchPath), fingerprint(stat))
          return ignored
        },
        ignorePermissionErrors: true,
        followSymlinks: false,
        depth: shallow ? 0 : 12,
        awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 }
      })
      // Chokidar can emit initial symlink additions despite ignoreInitial.
      // Do not let those enter the debounce queue and escape after ready.
      watcher.on('all', (event, file, stat) => {
        if (!initialized) return
        const key = path.resolve(file)
        // Suppress unchanged initialization replays using the scanned file state.
        // Filesystem timestamps and the process clock need not agree on Windows.
        if (event === 'change' && stat && initialFiles.get(key) === fingerprint(stat)) return
        initialFiles.delete(key)
        this.queue(root)
      })
      watcher.on('error', failed)
      this.watchers.set(root, {
        close: () => watcher.close(),
        ready: new Promise<void>((resolve) =>
          watcher.once('ready', () => {
            initialized = true
            resolve()
          })
        )
      })
    }
  }

  async ready(): Promise<void> {
    await Promise.all([...this.watchers.values()].map((watcher) => watcher.ready))
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

  private contains(parent: string, file: string): boolean {
    const relative = path.relative(parent, file)
    return (
      !relative ||
      (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
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
