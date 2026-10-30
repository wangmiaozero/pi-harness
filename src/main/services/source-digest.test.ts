// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { gitSourceFiles, sourceDigest } from '../../../scripts/release/source-digest.mjs'

it('streams a real Git inventory larger than 1 MiB without losing UTF-8 paths', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-source-inventory-'))
  const git = promisify(execFile)
  try {
    await git('git', ['init', '-q', dir])
    const blob = git('git', ['hash-object', '-w', '--stdin'], { cwd: dir })
    blob.child.stdin!.end('')
    const { stdout } = await blob
    const paths = Array.from(
      { length: 9000 },
      (_, i) => `resources/${'animation-'.repeat(13)}${i}/图像.webp`
    )
    const inventory = paths.map((file) => `100644 ${stdout.trim()}\t${file}\0`).join('')
    // Index-only entries avoid thousands of physical files and Windows path limits.
    const index = git('git', ['update-index', '-z', '--index-info'], { cwd: dir })
    index.child.stdin!.end(inventory)
    await index
    expect(Buffer.byteLength(paths.join('\0'))).toBeGreaterThan(1024 * 1024)
    expect((await gitSourceFiles(dir)).sort()).toEqual(paths.sort())
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

it('rejects a failed Git inventory instead of producing incomplete evidence', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-source-no-git-'))
  try {
    await expect(sourceDigest(dir)).rejects.toThrow('Git file inventory failed')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

it.each([
  'packages/harness-plugin-sdk/manifest.mjs',
  'examples/harness-plugins/run-metrics/main.mjs'
])('binds native release evidence to additions and edits in %s', async (file) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-source-digest-'))
  try {
    await promisify(execFile)('git', ['init', '-q', dir])
    const before = await sourceDigest(dir)
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
    await fs.writeFile(path.join(dir, file), 'first bytes\n')
    const added = await sourceDigest(dir)
    expect(added).not.toBe(before)
    await fs.writeFile(path.join(dir, file), 'different bytes\n')
    expect(await sourceDigest(dir)).not.toBe(added)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
