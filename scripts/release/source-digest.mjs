import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
export async function sourceDigest(root) {
  const { stdout } = await promisify(execFile)(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root }
  )
  const files = stdout
    .split('\0')
    .filter((file) =>
      /^(?:src\/|scripts\/|e2e\/|fixtures\/|resources\/|build\/|\.github\/|package\.json$|pnpm-lock\.yaml$|(?:electron|vitest|playwright|eslint|tsconfig)[^/]*\.(?:ts|mjs|json|yml)$)/.test(
        file
      )
    )
    .sort()
  const hash = createHash('sha256')
  for (const file of files) {
    const target = path.join(root, file)
    const stat = await fs.lstat(target)
    let bytes = stat.isSymbolicLink()
      ? Buffer.from(await fs.readlink(target))
      : await fs.readFile(target)
    if (!bytes.includes(0))
      try {
        bytes = Buffer.from(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\r\n', '\n')
        )
      } catch {
        /* Keep binary bytes. */
      }
    hash.update(`${file}\0${bytes.length}\0`)
    hash.update(bytes)
  }
  return hash.digest('hex')
}
