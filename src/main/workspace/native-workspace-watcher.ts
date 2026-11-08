import { randomBytes } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { lstat, readdir, realpath, unlink, writeFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'

export const WATCH_STREAM_SILENT = 'WATCH_SILENT'

/** macOS recursive fs.watch uses FSEvents rather than a descriptor for every file. */
export function watchNativeWorkspace(
  root: string,
  ignored: (file: string, directory?: boolean) => boolean,
  changed: () => void,
  failed: (error: NodeJS.ErrnoException) => void,
  recursive = true,
  options: { proveDelivery?: boolean; proveTimeoutMs?: number } = {}
): { close(): Promise<void>; ready: Promise<void> } {
  let closed = false
  let checking = false
  let rerun = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const initial = new Map<string, string>()
  const fingerprint = (stat: Stats): string =>
    `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.mode}`
  let watcher: FSWatcher | null = null
  let proving = false
  let canaryName = ''
  let markCanary = () => {}
  // /var and /private/var are the same directory. FSEvents may report either spelling.
  let canonicalRoot = path.resolve(root)
  const pending = new Set<string>()
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void notify().catch(failed)
    }, 250)
  }
  const relativeEvent = (filename: string): string | null => {
    const bases = canonicalRoot === root ? [root] : [root, canonicalRoot]
    for (const base of bases) {
      const relative = path.relative(base, path.resolve(base, filename))
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        continue
      return relative
    }
    return null
  }
  // A directory notification does not change the directory inode. The edit is in a child.
  const descendantsChanged = async (
    directory: string,
    relativeDirectory: string
  ): Promise<boolean> => {
    const seen = new Set<string>()
    const listed = new Set<string>()
    let live = false
    const directories = [
      {
        directory,
        depth: relativeDirectory ? relativeDirectory.split(path.sep).length : 0
      }
    ]
    while (!closed && directories.length) {
      const current = directories.pop()!
      const currentRelative = path.relative(root, current.directory)
      if (currentRelative.startsWith('..')) continue
      listed.add(currentRelative === '' ? '' : currentRelative)
      const entries = await readdir(current.directory, { withFileTypes: true }).catch((error) => {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
        throw error
      })
      for (let start = 0; !closed && start < entries.length; start += 16) {
        const found = await Promise.all(
          entries.slice(start, start + 16).map(async (entry) => {
            const file = path.join(current.directory, entry.name)
            if (entry.isSymbolicLink() || ignored(file, entry.isDirectory())) return null
            const stat = await lstat(file).catch(() => null)
            if (!stat || stat.isSymbolicLink()) return null
            const relative = path.relative(root, file)
            if (!relative || relative.startsWith('..') || relative.split(path.sep).length > 13)
              return null
            return { file, relative, stat }
          })
        )
        for (const item of found) {
          if (!item) continue
          seen.add(item.relative)
          const next = fingerprint(item.stat)
          if (initial.get(item.relative) !== next) {
            live = true
            initial.set(item.relative, next)
          }
          if (recursive && item.stat.isDirectory() && current.depth < 12)
            directories.push({ directory: item.file, depth: current.depth + 1 })
        }
      }
    }
    for (const key of [...initial.keys()]) {
      if (key === relativeDirectory) continue
      const parent = path.dirname(key)
      if (!listed.has(parent === '.' ? '' : parent) || seen.has(key)) continue
      initial.delete(key)
      live = true
    }
    return live
  }
  const notify = async (): Promise<void> => {
    if (checking) {
      rerun = true
      return
    }
    checking = true
    try {
      do {
        rerun = false
        while (!closed && pending.size) {
          const relative = pending.values().next().value!
          pending.delete(relative)
          if (!relative) {
            if (await descendantsChanged(root, '')) changed()
            continue
          }
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
              if (stat?.isDirectory()) {
                if (!(await descendantsChanged(current, relative))) visible = false
              } else if (!stat) initial.delete(relative)
              else if (initial.get(relative) === fingerprint(stat)) visible = false
              else initial.set(relative, fingerprint(stat))
            }
          }
          if (visible && !closed) changed()
        }
      } while (rerun && !closed)
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
    canonicalRoot = await realpath(root).catch(() => path.resolve(root))
    watcher = watch(root, { recursive }, onEvent)
    watcher.on('error', failed)
    if (!options.proveDelivery || closed) return
    // ready means a later edit cannot land before the stream is delivering.
    // A stream that never reports the probe is not usable; the caller falls back.
    canaryName = `.pi-harness-watch-${randomBytes(8).toString('hex')}`
    const canaryPath = path.join(root, canaryName)
    let observed = false
    const seen = new Promise<void>((resolve) => {
      markCanary = () => {
        observed = true
        resolve()
      }
    })
    proving = true
    try {
      await writeFile(canaryPath, '')
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (closed || observed) resolve()
          else {
            reject(
              Object.assign(new Error('Workspace watcher produced no events'), {
                code: WATCH_STREAM_SILENT
              })
            )
          }
        }, options.proveTimeoutMs ?? 1500)
        void seen.then(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    } finally {
      await unlink(canaryPath).catch(() => undefined)
      proving = false
    }
  })()

  function onEvent(_event: string, filename: string | null) {
    if (closed) return
    if (!filename) {
      if (proving) markCanary()
      else changed()
      return
    }
    const relative = relativeEvent(filename)
    if (relative === null) return
    if (canaryName && (relative === canaryName || path.basename(relative) === canaryName)) {
      markCanary()
      return
    }
    if (relative && ignored(path.join(root, relative))) return
    pending.add(relative)
    schedule()
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
