// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { stageAppImage } from './appimage-transaction.mjs'
import { signingFixture } from './security/signing-fixture'
import { selectInstaller, verifiedManifest } from './security/manifest.mjs'

const temporary: string[] = []
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await fs.rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'appimage-test-')))
  temporary.push(directory)
  const current = path.join(directory, 'Pi-Harness.AppImage')
  // Container header fixture only; these tests do not execute an AppImage runtime.
  const old = Buffer.concat([Buffer.from('7f454c4600000000414902', 'hex'), Buffer.from('old')])
  const next = Buffer.concat([old.subarray(0, 11), Buffer.from('new')])
  const verified = path.join(directory, 'download.AppImage')
  await fs.writeFile(current, old, { mode: 0o755 })
  await fs.writeFile(verified, next)
  const f = signingFixture()
  for (const item of f.manifest.artifacts) {
    item.size = next.length
    item.sha256 = createHash('sha256').update(next).digest('hex')
  }
  const bytes = f.encode()
  const signature = f.seal(bytes)
  const manifest = verifiedManifest(bytes, signature, f.trust, f.manifest.version)
  const candidate = {
    bytes,
    signature,
    manifest,
    version: manifest.version,
    installer: selectInstaller(manifest, 'linux', 'x64', 'standard')
  }
  return { directory, current, verified, old, next, candidate }
}

it('replaces the outer container with verified bytes and retains the previous container', async () => {
  const f = await fixture()
  const result = await stageAppImage(f.current, f.verified, f.candidate)
  expect(result.target).toBe(f.current)
  expect(await fs.readFile(result.target)).toEqual(f.next)
  expect(await fs.readFile(result.backup)).toEqual(f.old)
  if (process.platform !== 'win32') expect((await fs.stat(result.target)).mode & 0o100).toBe(0o100)
})

it('rejects an extracted Electron executable and a renamed non-container without modifying them', async () => {
  const f = await fixture()
  for (const name of ['pi-harness', 'extracted.AppImage']) {
    const extracted = path.join(f.directory, name)
    await fs.writeFile(extracted, 'extracted executable')
    await expect(stageAppImage(extracted, f.verified, f.candidate)).rejects.toThrow(
      name.endsWith('.AppImage') ? 'AppImage type 2' : 'supported AppImage'
    )
    expect(await fs.readFile(extracted, 'utf8')).toBe('extracted executable')
  }
  expect(await fs.readFile(f.current)).toEqual(f.old)
})

it('preserves the installed container and cleans staging when the downloaded bytes are corrupted', async () => {
  const f = await fixture()
  const corrupt = Buffer.from(f.next)
  corrupt[corrupt.length - 1] ^= 1
  await fs.writeFile(f.verified, corrupt)
  await expect(stageAppImage(f.current, f.verified, f.candidate)).rejects.toThrow('SHA-256')
  expect(await fs.readFile(f.current)).toEqual(f.old)
  expect((await fs.readdir(f.directory)).sort()).toEqual([
    'Pi-Harness.AppImage',
    'download.AppImage'
  ])
})
