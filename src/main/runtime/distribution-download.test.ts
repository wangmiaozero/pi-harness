// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { acquireDistribution } from './distribution.mjs'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function acquire(fetcher: typeof fetch) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-download-'))
  roots.push(root)
  return acquireDistribution({
    kind: 'node',
    platform: 'linux',
    arch: 'x64',
    destination: path.join(root, 'node'),
    cache: path.join(root, 'cache'),
    fetcher
  })
}

it('retries a gateway timeout and then checks the runtime checksum', async () => {
  let attempts = 0
  const fetcher = vi.fn(async () =>
    ++attempts === 1
      ? new Response('busy', { status: 504 })
      : new Response('not-a-checksum', { status: 200 })
  )
  await expect(acquire(fetcher)).rejects.toThrow('Runtime download SHA256 mismatch')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('does not retry a missing runtime asset', async () => {
  const fetcher = vi.fn(async () => new Response('missing', { status: 404 }))
  await expect(acquire(fetcher)).rejects.toThrow('HTTP 404')
  expect(fetcher).toHaveBeenCalledOnce()
})

it('stops after three gateway timeouts', async () => {
  const fetcher = vi.fn(async () => new Response('busy', { status: 504 }))
  await expect(acquire(fetcher)).rejects.toThrow('HTTP 504')
  expect(fetcher).toHaveBeenCalledTimes(3)
})
