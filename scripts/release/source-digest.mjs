import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
/** Stream NUL-delimited paths; large asset trees exceed execFile's output cap. */
export async function gitSourceFiles(root) {
  const child = spawn('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4096)
  })
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Git file inventory failed (${code}): ${stderr}`))
    )
  })
  const files = []
  const read = async () => {
    child.stdout.setEncoding('utf8')
    let pending = ''
    for await (const chunk of child.stdout) {
      const paths = (pending + chunk).split('\0')
      pending = paths.pop()
      files.push(...paths)
    }
    if (pending) throw new Error('Git file inventory ended with an incomplete path')
  }
  await Promise.all([read(), exit])
  return files
}
export async function sourceDigest(root) {
  const files = (await gitSourceFiles(root))
    .filter((file) =>
      /^(?:src\/|packages\/harness-plugin-sdk\/|examples\/harness-plugins\/|scripts\/|patches\/|e2e\/|fixtures\/|resources\/|build\/|\.github\/|package\.json$|pnpm-lock\.yaml$|(?:electron|vitest|playwright|eslint|tsconfig)[^/]*\.(?:ts|js|mjs|json|yml)$)/.test(
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
