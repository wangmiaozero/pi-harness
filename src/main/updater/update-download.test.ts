// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { signingFixture } from './security/signing-fixture'
import { verifiedManifest, selectInstaller } from './security/manifest.mjs'
import { UpdateDownload } from './update-download'
import type { TrustedCandidate } from './update-provider'
const temporary: string[] = []
afterEach(async () => {
  for (const dir of temporary.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})
async function setup() {
  const f = signingFixture(),
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-update-'))
  temporary.push(directory)
  const manifest = verifiedManifest(f.bytes, f.signature, f.trust, '2.0.1')
  const candidate: TrustedCandidate = {
    version: '2.0.1',
    manifest,
    installer: selectInstaller(manifest, 'darwin', 'arm64', 'standard'),
    bytes: f.bytes,
    signature: f.signature
  }
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(new Uint8Array(f.payload))
  )
  return {
    f,
    directory,
    candidate,
    fetcher,
    downloader: new UpdateDownload({ directory, fetcher })
  }
}
const progress = () => {}
it('keeps interrupted bytes and resumes with the exact signed Range', async () => {
  const { f, candidate, fetcher, downloader } = await setup()
  fetcher.mockImplementationOnce(async () => {
    let count = 0
    return new Response(
      new ReadableStream({
        pull(c) {
          if (count++ === 0) c.enqueue(new Uint8Array(f.payload.subarray(0, 5)))
          else c.error(new Error('broken network'))
        }
      })
    )
  })
  await expect(
    downloader.run(candidate, new AbortController().signal, progress, progress)
  ).rejects.toMatchObject({ reason: 'NETWORK_DOWNLOAD_FAILED' })
  fetcher.mockImplementationOnce(async (_url, init) => {
    expect((init!.headers as Record<string, string>).Range).toBe('bytes=5-')
    return new Response(new Uint8Array(f.payload.subarray(5)), {
      status: 206,
      headers: {
        'Content-Range': `bytes 5-${f.payload.length - 1}/${f.payload.length}`,
        'Content-Length': String(f.payload.length - 5)
      }
    })
  })
  const file = await downloader.run(candidate, new AbortController().signal, progress, progress)
  expect(await fs.readFile(file)).toEqual(f.payload)
})
it('does not append when the server ignores Range', async () => {
  const { f, candidate, fetcher, downloader } = await setup()
  fetcher.mockImplementationOnce(async () => {
    let count = 0
    return new Response(
      new ReadableStream({
        pull(c) {
          if (count++ === 0) c.enqueue(new Uint8Array(f.payload.subarray(0, 5)))
          else c.error(new Error('offline'))
        }
      })
    )
  })
  await expect(
    downloader.run(candidate, new AbortController().signal, progress, progress)
  ).rejects.toThrow()
  const file = await downloader.run(candidate, new AbortController().signal, progress, progress)
  expect(await fs.readFile(file)).toEqual(f.payload)
})
it.each(['bytes 0-16/17', 'bytes 5-15/999', 'bytes 5-99/17', 'garbage'])(
  'rejects forged resume metadata %s',
  async (range) => {
    const { f, candidate, fetcher, downloader } = await setup()
    fetcher.mockImplementationOnce(async () => {
      let count = 0
      return new Response(
        new ReadableStream({
          pull(c) {
            if (count++ === 0) c.enqueue(new Uint8Array(f.payload.subarray(0, 5)))
            else c.error(new Error('offline'))
          }
        })
      )
    })
    await expect(
      downloader.run(candidate, new AbortController().signal, progress, progress)
    ).rejects.toThrow()
    fetcher.mockResolvedValueOnce(
      new Response(new Uint8Array(f.payload.subarray(5)), {
        status: 206,
        headers: { 'Content-Range': range }
      })
    )
    await expect(
      downloader.run(candidate, new AbortController().signal, progress, progress)
    ).rejects.toMatchObject({ reason: 'RANGE_REJECTED' })
  }
)
it('rejects same-size corrupted data and clears the unsafe partial before retry', async () => {
  const { f, candidate, fetcher, downloader } = await setup()
  fetcher.mockResolvedValueOnce(new Response(new Uint8Array(Buffer.alloc(f.payload.length, 1))))
  await expect(
    downloader.run(candidate, new AbortController().signal, progress, progress)
  ).rejects.toMatchObject({ reason: 'INTEGRITY_FAILED' })
  expect(
    await fs.readFile(
      await downloader.run(candidate, new AbortController().signal, progress, progress)
    )
  ).toEqual(f.payload)
  expect((fetcher.mock.calls[1][1]!.headers as Record<string, string>).Range).toBeUndefined()
})
it('cancels a streaming download, retains safe partial bytes and prevents promotion', async () => {
  const { f, candidate, fetcher, downloader, directory } = await setup(),
    controller = new AbortController()
  fetcher.mockImplementationOnce(
    async (_url, init) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(f.payload.subarray(0, 5)))
            init!.signal!.addEventListener('abort', () => c.error(new Error('cancelled')), {
              once: true
            })
          }
        })
      )
  )
  const task = downloader.run(candidate, controller.signal, () => controller.abort(), progress)
  await expect(task).rejects.toMatchObject({ reason: 'DOWNLOAD_CANCELLED' })
  const files = await fs.readdir(path.join(directory, (await fs.readdir(directory))[0]))
  expect(files).not.toContain(candidate.installer.file)
})
it('does not trust a verified filename after cached bytes have changed', async () => {
  const { candidate, downloader } = await setup()
  const file = await downloader.run(candidate, new AbortController().signal, progress, progress)
  await fs.writeFile(file, 'tampered')
  await expect(downloader.revalidate(candidate, file)).rejects.toMatchObject({
    reason: 'INTEGRITY_FAILED'
  })
  await expect(
    downloader.revalidate(candidate, path.join(path.dirname(file), '../other'))
  ).rejects.toMatchObject({ reason: 'CACHE_REJECTED' })
})
