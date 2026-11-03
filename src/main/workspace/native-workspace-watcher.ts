import { watch, type FSWatcher } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'

/** macOS recursive fs.watch uses FSEvents rather than a descriptor for every file. */
export function watchNativeWorkspace(
  root: string,
  ignored: (file: string, directory?: boolean) => boolean,
  changed: () => void,
  failed: (error: NodeJS.ErrnoException) => void,
  recursive = true
): { close(): Promise<void>; ready: Promise<void> } {
  let closed = false
  let checking = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const initial = new Map<string, string>()
  const fingerprint = (stat: Stats): string =>
    `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.mode}`
  let watcher: FSWatcher | null = null
  const pending = new Set<string>()
  const notify = async (): Promise<void> => {
    if (checking) return
    checking = true
    try {
      while (!closed && pending.size) {
        const relative = pending.values().next().value!
        pending.delete(relative)
        const segments = relative.split(path.sep).filter(Boolean)
        if (segments.length > 13 || ignored(path.join(root, relative))) continue
        let current = root
        let visible = true
        // Do not follow a linked directory, even if the native backend reports it.
        for (const [index, segment] of segments.entries()) {
          current = path.join(current, segment)
          const stat = await lstat(current).catch(() => null)
          if (stat?.isSymbolicLink() || ignored(current, stat?.isDirectory())) {
            visible = false
            break
          }
          if (index < segments.length - 1 && stat && !stat.isDirectory()) {
            visible = false
            break
          }
          // Compare file state, never filesystem time against the process clock.
          if (index === segments.length - 1) {
            if (stat && initial.get(relative) === fingerprint(stat)) visible = false
            else initial.delete(relative)
          }
        }
        if (visible && !closed) changed()
      }
    } finally {
      checking = false
    }
  }
  // Snapshot only the live scope, with bounded metadata I/O and no open file
  // subscriptions. ready means both the baseline and native stream are installed.
  const ready = (async () => {
    const directories = [{ directory: root, depth: 0 }]
    while (!closed && directories.length) {
      const { directory, depth } = directories.pop()!
      if (directory !== root) {
        const stat = await lstat(directory).catch(() => null)
        if (!stat?.isDirectory() || stat.isSymbolicLink()) continue
      }
      const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
        throw error
      })
      for (let start = 0; !closed && start < entries.length; start += 16) {
        await Promise.all(
          entries.slice(start, start + 16).map(async (entry) => {
            const file = path.join(directory, entry.name)
            if (entry.isSymbolicLink() || ignored(file, entry.isDirectory())) return
            const stat = await lstat(file).catch(() => null)
            if (!stat || stat.isSymbolicLink()) return
            initial.set(path.relative(root, file), fingerprint(stat))
            if (recursive && stat.isDirectory() && depth < 12)
              directories.push({ directory: file, depth: depth + 1 })
          })
        )
      }
    }
    if (closed) return
    watcher = watch(root, { recursive }, onEvent)
    watcher.on('error', failed)
  })()

  function onEvent(_event: string, filename: string | null) {
    if (closed) return
    if (!filename) {
      changed()
      return
    }
    const relative = path.relative(root, path.resolve(root, filename))
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)) return
    if (ignored(path.join(root, relative))) return
    pending.add(relative)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void notify().catch(failed)
    }, 250)
  }
  return {
    ready,
    async close() {
      if (closed) return
      closed = true
      if (timer) clearTimeout(timer)
      timer = null
      pending.clear()
      await ready.catch(() => undefined)
      initial.clear()
      watcher?.close()
    }
  }
}
