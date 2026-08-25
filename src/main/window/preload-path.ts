import path from 'node:path'
import fs from 'node:fs'

export type PreloadEntry = 'index' | 'overlay'

export function resolvePreload(entry: PreloadEntry = 'index'): string {
  const dir = path.join(import.meta.dirname, '../preload')
  for (const name of [`${entry}.js`, `${entry}.cjs`, `${entry}.mjs`]) {
    const candidate = path.join(dir, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return path.join(dir, `${entry}.mjs`)
}
