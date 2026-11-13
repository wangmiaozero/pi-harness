// @vitest-environment node
import { expect, it, vi } from 'vitest'
import type { ChatGptAccounts } from '../services/chatgpt-accounts'
import { ChatGptResponsesBridge } from './chatgpt-responses-bridge'

it('binds Gemini SDK requests to an unguessable provider route', async () => {
  const forward = vi.fn(async () => new Response('data: fixture\n\n'))
  const bridge = new ChatGptResponsesBridge(undefined, forward)
  const upstream = 'https://generativelanguage.example/v1beta'
  const base = await bridge.googleBaseUrl('google', upstream)
  try {
    const call = (url: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': 'fixture', 'content-type': 'application/json' },
        body: '{}'
      })
    expect((await call(`${base}/models/fixture:streamGenerateContent?alt=sse`)).status).toBe(200)
    expect(forward).toHaveBeenCalledExactlyOnceWith(
      'google',
      upstream,
      new URL(`${upstream}/models/fixture:streamGenerateContent?alt=sse`),
      expect.objectContaining({ headers: expect.any(Headers), body: expect.any(Uint8Array) })
    )
    expect((await call(`${base}/models/fixture:delete`)).status).toBe(404)
    expect(
      (
        await call(
          base.replace(/[0-9a-f]{64}$/, '0'.repeat(64)) + '/models/fixture:generateContent'
        )
      ).status
    ).toBe(404)
  } finally {
    await bridge.close()
  }
})

it('requires the bridge token and a matching stateless model request before forwarding', async () => {
  const fetchResponses = vi.fn<ChatGptAccounts['fetchResponses']>()
  const bridge = new ChatGptResponsesBridge({ fetchResponses })
  const { url, token } = await bridge.start()
  const id = 'chatgpt-account-493957de-923a-4681-b5b6-d8de350c293a'
  const model = 'gpt-6.1-sol'
  const headers = {
    authorization: `Bearer ${token}`,
    'x-chatgpt-account': id,
    'x-chatgpt-model': model
  }
  const request = (headers: HeadersInit, input: Record<string, unknown>) =>
    fetch(url, { method: 'POST', headers, body: JSON.stringify(input) })
  const payload = { model, stream: true, store: false }
  try {
    expect((await request({ ...headers, authorization: 'Bearer invalid' }, payload)).status).toBe(
      404
    )
    expect((await request(headers, { ...payload, model: 'different' })).status).toBe(400)
    expect((await request(headers, { ...payload, store: true })).status).toBe(400)
    expect(fetchResponses).not.toHaveBeenCalled()
    fetchResponses.mockResolvedValueOnce(
      new Response('data: fixture\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      })
    )
    const response = await request(headers, payload)
    expect(await response.text()).toBe('data: fixture\n\n')
    expect(fetchResponses).toHaveBeenCalledExactlyOnceWith(
      id,
      model,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  } finally {
    await bridge.close()
  }
})
