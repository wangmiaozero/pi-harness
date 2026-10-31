// @vitest-environment node
import { expect, it } from 'vitest'
import { fetchOfficial, readBounded } from './security/transport.mjs'
import { createReleaseFetcher } from './release-fetch'
import { fakeNetRequest } from './net-request-fixture'

const asset = 'https://github.com/wangmiaozero/pi-harness/releases/download/v2.4.0/checksums.json'
const cdn =
  'https://release-assets.githubusercontent.com/github-production-release-asset/1/checksums.json?sig=x'

it('returns the GitHub redirect unfollowed so the CDN hop is validated and then fetched', async () => {
  const network = fakeNetRequest(async (url) =>
    url === asset
      ? new Response(null, { status: 302, headers: { location: cdn } })
      : new Response('signed manifest', { status: 200, headers: { 'content-length': '15' } })
  )
  const response = await fetchOfficial(asset, createReleaseFetcher(network.request), {
    headers: { 'Accept-Encoding': 'identity', Range: 'bytes=0-' }
  })
  expect((await readBounded(response, 1024)).toString()).toBe('signed manifest')
  expect(response.headers.get('content-length')).toBe('15')
  expect(network.requests.map((item) => item.options.url)).toEqual([asset, cdn])
  expect(network.requests[0].aborted).toBe(true)
  for (const item of network.requests) {
    expect(item.options).toMatchObject({
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store'
    })
    expect(item.headers).toMatchObject({ 'accept-encoding': 'identity', range: 'bytes=0-' })
  }
})

it('never requests an untrusted redirect target', async () => {
  const network = fakeNetRequest(
    async () =>
      new Response(null, { status: 302, headers: { location: 'https://evil.example/payload' } })
  )
  await expect(fetchOfficial(asset, createReleaseFetcher(network.request))).rejects.toThrow(
    'Untrusted release download source'
  )
  expect(network.requests).toHaveLength(1)
})

it('preserves resume status and headers and allows bodiless statuses', async () => {
  const fetcher = createReleaseFetcher(
    fakeNetRequest(async (url) =>
      url.endsWith('/empty')
        ? new Response(null, { status: 304 })
        : new Response('tail', {
            status: 206,
            headers: { 'content-range': 'bytes 6-9/10', 'content-length': '4' }
          })
    ).request
  )
  const partial = await fetcher(cdn)
  expect(partial.status).toBe(206)
  expect(partial.headers.get('content-range')).toBe('bytes 6-9/10')
  expect(await partial.text()).toBe('tail')
  const empty = await fetcher(`${cdn}/empty`)
  expect(empty.status).toBe(304)
  expect(empty.body).toBeNull()
})

it('aborts the Electron request before and during the response body', async () => {
  const network = fakeNetRequest(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]))
          }
        })
      )
  )
  const fetcher = createReleaseFetcher(network.request)
  await expect(fetcher(cdn, { signal: AbortSignal.abort() })).rejects.toThrow()
  expect(network.requests).toHaveLength(0)
  const controller = new AbortController()
  const reader = (await fetcher(cdn, { signal: controller.signal })).body!.getReader()
  expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]))
  const pending = reader.read()
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(network.requests[0].aborted).toBe(true)
})

it('reports network failures and refuses request bodies', async () => {
  const offline = new Error('getaddrinfo ENOTFOUND github.com')
  const fetcher = createReleaseFetcher(
    fakeNetRequest(async () => {
      throw offline
    }).request
  )
  await expect(fetcher(asset)).rejects.toBe(offline)
  await expect(fetcher(asset, { method: 'POST' })).rejects.toThrow('must use GET')
})
