// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { prepareDistribution } from '../../../scripts/runtime/prepared-runtime.mjs'
import { catalog } from './distribution.mjs'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prepared-node-'))
  roots.push(root)
  const destination = path.join(root, 'node')
  await fs.mkdir(destination)
  await fs.writeFile(
    path.join(destination, 'runtime-receipt.json'),
    JSON.stringify({ kind: 'node', platform: 'darwin', arch: 'arm64', version: '24.22.0' })
  )
  await fs.writeFile(path.join(destination, 'version'), 'old')
  const options = {
    destination,
    kind: 'node' as const,
    platform: 'darwin',
    arch: 'arm64',
    cache: root
  }
  const acquire = vi.fn(async ({ destination: target }: { destination: string }) => {
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, 'version'), catalog.node.version)
  })
  const verify = vi.fn(async (target: string) => {
    if ((await fs.readFile(path.join(target, 'version'), 'utf8')) !== catalog.node.version)
      throw new Error('integrity mismatch')
  })
  return { options, acquire, verify, destination }
}
it('automatically replaces an old prepared version only after verifying the candidate', async () => {
  const f = await fixture()
  await prepareDistribution(f.options, f)
  expect(await fs.readFile(path.join(f.destination, 'version'), 'utf8')).toBe(catalog.node.version)
  expect(f.verify.mock.calls[0][0]).toContain('.replacement')
})
it.each(['download', 'checksum', 'activation'])(
  'preserves the old runtime on %s failure',
  async (failure) => {
    const f = await fixture()
    if (failure === 'download') f.acquire.mockRejectedValue(new Error('download failed'))
    if (failure === 'checksum') f.verify.mockRejectedValue(new Error('checksum mismatch'))
    const rename = async (from: string, to: string) => {
      if (failure === 'activation' && from.endsWith('.replacement'))
        throw new Error('activation failed')
      await fs.rename(from, to)
    }
    await expect(prepareDistribution(f.options, { ...f, rename })).rejects.toThrow()
    expect(await fs.readFile(path.join(f.destination, 'version'), 'utf8')).toBe('old')
  }
)
it('verify mode rejects stale resources without downloading or replacing them', async () => {
  const f = await fixture()
  await expect(prepareDistribution({ ...f.options, verifyOnly: true }, f)).rejects.toThrow(
    'integrity'
  )
  expect(f.acquire).not.toHaveBeenCalled()
  expect(await fs.readFile(path.join(f.destination, 'version'), 'utf8')).toBe('old')
})
