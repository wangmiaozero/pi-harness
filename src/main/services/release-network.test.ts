// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
// @ts-expect-error Release transport runs as Node ESM without declarations.
import { createReleaseClient } from '../../../scripts/release/github-release-client.mjs'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})
function reset() {
  return new TypeError('fetch failed; secret must not be logged', {
    cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })
  })
}
function interruptedBody(prefix = 'partial') {
  let sent = false
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (sent) controller.error(reset())
        else {
          sent = true
          controller.enqueue(Buffer.from(prefix))
        }
      }
    })
  )
}
async function fixture(extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'release-network-'))
  directories.push(directory)
  const payload = Buffer.from('complete installer bytes')
  const file = {
    name: 'installer.exe',
    path: path.join(directory, 'installer.exe'),
    size: payload.length
  }
  await fs.writeFile(file.path, payload)
  const release = {
    id: 1,
    draft: true,
    tag_name: 'v2.3.11',
    target_commitish: 'source',
    body: 'owned-marker',
    upload_url:
      'https://uploads.github.com/repos/wangmiaozero/pi-harness/releases/1/assets{?name,label}',
    assets: [] as Array<{ id: number; name: string; size: number; state: string }>
  }
  const asset = { id: 2, name: file.name, size: file.size, state: 'uploaded' }
  const logs: string[] = []
  const fetcher = vi.fn(async (url: string | URL, options: any) => {
    const target = new URL(url)
    if (target.pathname.endsWith('/releases/1/assets')) return Response.json(release.assets)
    if (target.pathname.endsWith('/releases/assets/2')) return new Response(payload)
    if (options.method === 'POST' || options.method === 'PATCH') return Response.json(release)
    return Response.json(release)
  })
  const client = createReleaseClient({
    repository: 'wangmiaozero/pi-harness',
    token: 'dummy-token',
    marker: 'owned-marker',
    revision: 'source',
    tag: 'v2.3.11',
    files: [file],
    fetcher,
    pause: async () => {},
    log: (message: string) => logs.push(message),
    ...extra
  })
  return { client, fetcher, file, payload, release, asset, logs }
}

it('recovers reset metadata reads, including a reset while consuming JSON, within one deadline', async () => {
  const f = await fixture()
  const calls: AbortSignal[] = []
  f.fetcher.mockImplementation(async (url, options) => {
    calls.push(options.signal)
    if (calls.length === 1) throw reset()
    if (calls.length === 2) return interruptedBody('{"id":')
    return Response.json(new URL(url).pathname.endsWith('/assets') ? [] : f.release)
  })
  // Find consumes metadata and then fetches the release plus its paginated asset list.
  await expect(f.client.find('v2.3.11')).resolves.toMatchObject({ id: 1, draft: true })
  expect(calls[0]).toBe(calls[1])
  expect(calls[1]).toBe(calls[2])
  expect(f.logs.join('\n')).toContain('ECONNRESET')
  expect(f.logs.join('\n')).not.toMatch(/dummy-token|secret must not be logged/)
})

it.each([401, 403, 422])(
  'fails metadata HTTP %s without retrying authentication or validation failures',
  async (status) => {
    const f = await fixture()
    f.fetcher.mockResolvedValue(new Response('failure', { status }))
    await expect(f.client.find('v2.3.11')).rejects.toThrow(`HTTP ${status}`)
    expect(f.fetcher).toHaveBeenCalledOnce()
  }
)

it('bounds transient metadata failures to three attempts and preserves missing-release behavior', async () => {
  const f = await fixture()
  f.fetcher.mockImplementation(async () => new Response('unavailable', { status: 503 }))
  await expect(f.client.find('v2.3.11')).rejects.toThrow('HTTP 503')
  expect(f.fetcher).toHaveBeenCalledTimes(3)
  f.fetcher
    .mockClear()
    .mockImplementation(async (url) =>
      new URL(url).pathname.endsWith('/releases')
        ? Response.json([])
        : new Response('not found', { status: 404 })
    )
  await expect(f.client.find('v2.3.11')).resolves.toBeNull()
  expect(f.fetcher).toHaveBeenCalledTimes(2)
})

it('finds an existing unpublished draft across pages when the published-tag endpoint returns 404', async () => {
  const f = await fixture()
  const fallback = f.fetcher.getMockImplementation()!
  f.fetcher.mockImplementation(async (url, options) => {
    const target = new URL(url)
    if (target.pathname.includes('/tags/')) return new Response(null, { status: 404 })
    if (target.pathname.endsWith('/releases')) {
      return Response.json(
        target.searchParams.get('page') === '1'
          ? Array.from({ length: 100 }, (_, i) => ({ id: i + 100, tag_name: `v1.0.${i}` }))
          : [f.release]
      )
    }
    return fallback(url, options)
  })
  await expect(f.client.find('v2.3.11')).resolves.toMatchObject({ id: 1, draft: true })
  expect(f.fetcher.mock.calls.every(([, options]) => !options.method)).toBe(true)
})

it('refuses ambiguous matching drafts instead of creating or choosing another one', async () => {
  const f = await fixture()
  f.fetcher.mockImplementation(async (url) =>
    new URL(url).pathname.includes('/tags/')
      ? new Response(null, { status: 404 })
      : Response.json([f.release, { ...f.release, id: 3 }])
  )
  await expect(f.client.find('v2.3.11')).rejects.toThrow('Multiple releases use this tag')
  expect(f.fetcher.mock.calls.every(([, options]) => !options.method)).toBe(true)
})

it('reopens the entire local stream only after confirming the failed upload is absent', async () => {
  const f = await fixture()
  const streams: any[] = [],
    bodies: Buffer[] = [],
    signals: AbortSignal[] = []
  f.fetcher.mockImplementation(async (url, options) => {
    if (options.method !== 'POST') {
      return Response.json(new URL(url).pathname.endsWith('/assets') ? [] : f.release)
    }
    streams.push(options.body)
    signals.push(options.signal)
    const chunks: Buffer[] = []
    for await (const bytes of options.body) chunks.push(bytes)
    bodies.push(Buffer.concat(chunks))
    if (streams.length === 1) throw reset()
    return Response.json(f.asset)
  })
  await f.client.upload(f.release, f.file)
  expect(bodies).toEqual([f.payload, f.payload])
  expect(streams[0]).not.toBe(streams[1])
  expect(streams.every((stream) => stream.destroyed)).toBe(true)
  expect(signals[0]).toBe(signals[1])
  expect(f.logs.join('\n')).toContain('remote absence confirmed')
})

it('reconciles an upload whose response was lost after commit, without sending it twice', async () => {
  const f = await fixture()
  let posts = 0
  f.fetcher.mockImplementation(async (url, options) => {
    if (options.method === 'POST') {
      posts++
      const chunks: Buffer[] = []
      for await (const bytes of options.body) chunks.push(bytes)
      expect(Buffer.concat(chunks)).toEqual(f.payload)
      f.release.assets.push(f.asset)
      return interruptedBody('{"id":')
    }
    return Response.json(new URL(url).pathname.endsWith('/assets') ? f.release.assets : f.release)
  })
  await f.client.upload(f.release, f.file)
  expect(posts).toBe(1)
  expect(f.logs.join('\n')).toContain('remote bytes will be verified')
})

it.each([
  { draft: false },
  { body: 'another run' },
  { target_commitish: 'another source' },
  { tag_name: 'v9.0.0' }
])('does not resume uploads after ownership changes: %j', async (change) => {
  const f = await fixture()
  let posts = 0
  f.fetcher.mockImplementation(async (url, options) => {
    if (options.method === 'POST') {
      posts++
      Object.assign(f.release, change)
      throw reset()
    }
    return Response.json(new URL(url).pathname.endsWith('/assets') ? [] : f.release)
  })
  await expect(f.client.upload(f.release, f.file)).rejects.toThrow('protected')
  expect(posts).toBe(1)
})

it('preserves incomplete or mismatched existing assets instead of deleting or replacing them', async () => {
  const f = await fixture()
  const methods: string[] = []
  f.fetcher.mockImplementation(async (url, options) => {
    methods.push(options.method ?? 'GET')
    if (options.method === 'POST') {
      f.release.assets.push({ ...f.asset, size: 0, state: 'starter' })
      throw reset()
    }
    return Response.json(new URL(url).pathname.endsWith('/assets') ? f.release.assets : f.release)
  })
  await expect(f.client.upload(f.release, f.file)).rejects.toThrow('refusing to replace')
  expect(methods.filter((method) => method === 'POST')).toHaveLength(1)
  expect(methods).not.toContain('DELETE')
})

it('restarts a reset asset download with a fresh hash and fails closed on truncated bytes', async () => {
  const f = await fixture()
  f.fetcher.mockResolvedValueOnce(interruptedBody()).mockResolvedValueOnce(new Response(f.payload))
  await expect(f.client.hash(f.asset)).resolves.toBe(
    createHash('sha256').update(f.payload).digest('hex')
  )
  expect(f.fetcher).toHaveBeenCalledTimes(2)
  f.fetcher.mockClear().mockResolvedValue(new Response('short'))
  await expect(f.client.hash(f.asset)).rejects.toThrow('Remote asset download was truncated')
  expect(f.fetcher).toHaveBeenCalledOnce()
})

it('recovers transient HTTP download failures but never retries excess bytes', async () => {
  const f = await fixture()
  f.fetcher
    .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    .mockResolvedValueOnce(new Response(f.payload))
  await expect(f.client.read(f.asset, f.payload.length)).resolves.toEqual(f.payload)
  expect(f.fetcher).toHaveBeenCalledTimes(2)
  f.fetcher.mockClear().mockImplementation(async () => new Response(f.payload))
  await expect(f.client.hash({ ...f.asset, size: 1 })).rejects.toThrow('exceeds its declared size')
  expect(f.fetcher).toHaveBeenCalledOnce()
  f.fetcher.mockClear()
  await expect(f.client.read(f.asset, 1)).rejects.toThrow('Read signed release asset')
  expect(f.fetcher).toHaveBeenCalledOnce()
})

it('refuses an untrusted upload destination before opening a network request', async () => {
  const f = await fixture()
  await expect(
    f.client.upload({ ...f.release, upload_url: 'https://example.com/asset' }, f.file)
  ).rejects.toThrow('Unexpected asset upload host or path')
  expect(f.fetcher).not.toHaveBeenCalled()
})

it('strips API credentials at an allowed CDN redirect and rejects other hosts', async () => {
  const f = await fixture()
  const cdn =
    'https://release-assets.githubusercontent.com/github-production-release-asset/test?sig=private'
  f.fetcher
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: cdn } }))
    .mockResolvedValueOnce(new Response(f.payload))
  await f.client.hash(f.asset)
  expect(f.fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer dummy-token')
  expect(f.fetcher.mock.calls[1][1].headers.Authorization).toBeUndefined()
  f.fetcher
    .mockClear()
    .mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://example.com/asset' } })
    )
  await expect(f.client.hash(f.asset)).rejects.toThrow('Verify remote asset')
  expect(f.fetcher).toHaveBeenCalledOnce()
  expect(f.logs.join('\n')).not.toContain('sig=private')
})

it('never blindly retries draft creation or publication after an unknown mutation result', async () => {
  const f = await fixture()
  f.fetcher.mockRejectedValue(reset())
  await expect(f.client.create({})).rejects.toThrow('reconcile before another creation')
  expect(f.fetcher).toHaveBeenCalledOnce()
  f.fetcher.mockClear()
  await expect(f.client.publish(1)).rejects.toThrow('check remote state')
  expect(f.fetcher).toHaveBeenCalledOnce()
})

it('honors the original operation deadline without granting a new budget for another attempt', async () => {
  const f = await fixture({ timeoutMs: 100 })
  f.fetcher.mockImplementation(
    async (_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true
        })
      })
  )
  await expect(f.client.find('v2.3.11')).rejects.toThrow('deadline exceeded')
  expect(f.fetcher).toHaveBeenCalledOnce()
})
