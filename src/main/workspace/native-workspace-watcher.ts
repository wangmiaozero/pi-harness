import { watch, type FSWatcher } from 'node:fs'
import { lstat } from 'node:fs/promises'
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
  const started = performance.timeOrigin + performance.now()
  let initializing = true
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
          // FSEvents may deliver a just-created file from before subscription.
          // Ignore that initial replay, while retaining changes made after start.
          if (
            initializing &&
            index === segments.length - 1 &&
            stat &&
            Math.max(stat.ctimeMs, stat.mtimeMs) < started
          )
            visible = false
        }
        if (visible && !closed) changed()
      }
    } finally {
      checking = false
      initializing = false
    }
  }
  const watcher: FSWatcher = watch(root, { recursive }, (_event, filename) => {
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
  })
  watcher.on('error', failed)
  return {
    ready: Promise.resolve(),
    async close() {
      closed = true
      if (timer) clearTimeout(timer)
      timer = null
      pending.clear()
      watcher.close()
    }
  }
}
