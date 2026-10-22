// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { sourceDigest } from '../../../scripts/release/source-digest.mjs'

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
