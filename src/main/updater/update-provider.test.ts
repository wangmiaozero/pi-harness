// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { ReleaseProvider } from './update-provider'
afterEach(() => vi.restoreAllMocks())
it('keeps metadata timeouts active when the manager also supplies a cancellation signal', async () => {
  const deadline = new AbortController()
  const caller = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  const signals: AbortSignal[] = []
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const signal = init!.signal as AbortSignal
    signals.push(signal)
    if (signal.aborted) throw signal.reason
    return new Promise<Response>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    )
  })
  const provider = new ReleaseProvider({
    fetcher,
    platform: 'linux',
    arch: 'x64',
    variant: 'standard'
  })
  const pending = provider.authenticate('2.0.1', '2.0.0', caller.signal)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  deadline.abort(new DOMException('Timed out', 'TimeoutError'))
  await expect(pending).rejects.toMatchObject({ reason: 'SIGNATURE_MISSING' })
  expect(caller.signal.aborted).toBe(false)
  expect(signals[0].aborted).toBe(true)
})
it.each([
  null,
  {},
  { tag_name: 'bad' },
  { tag_name: 'v2.0.0-beta.1' },
  { tag_name: 'v2.0.1', draft: true },
  { tag_name: 'v2.0.1', prerelease: true }
])('rejects invalid/unpublished latest metadata %j', async (data) => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(data)))
  await expect(
    new ReleaseProvider({ fetcher, platform: 'linux', arch: 'x64', variant: 'standard' }).latest()
  ).rejects.toMatchObject({ reason: 'NETWORK_CHECK_FAILED' })
})
it('uses only same-repository redirects for historical version-only fallback', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 429 }))
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: '/wangmiaozero/pi-harness/releases/tag/v2.0.1' }
      })
    )
    .mockResolvedValueOnce(new Response('release'))
  expect(
    await new ReleaseProvider({
      fetcher,
      platform: 'linux',
      arch: 'x64',
      variant: 'standard'
    }).latest()
  ).toBe('2.0.1')
})
it.each([
  'https://evil.example/tag/v2.0.1',
  'https://github.com/other/repo/releases/tag/v2.0.1',
  'http://github.com/wangmiaozero/pi-harness/releases/tag/v2.0.1'
])('does not follow an untrusted version redirect %s', async (url) => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 429 }))
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: url } }))
  await expect(
    new ReleaseProvider({ fetcher, platform: 'linux', arch: 'x64', variant: 'standard' }).latest()
  ).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(2)
})
