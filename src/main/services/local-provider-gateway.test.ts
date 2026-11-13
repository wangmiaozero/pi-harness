// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { once } from 'node:events'
import WebSocket from 'ws'
import { LocalProviderGateway } from './local-provider-gateway'

it('protects the local model list and forwards HTTP and WebSocket streams', async () => {
  const gatewayRequest = vi.fn(
    async () =>
      new Response('data: {"type":"response.completed"}\n\n', {
        headers: { 'content-type': 'text/event-stream', 'x-trace-id': 'fixture' }
      })
  )
  const gateway = new LocalProviderGateway({
    gatewayModels: async () => [
      {
        id: 'fixture/model',
        provider: 'fixture',
        model: 'model',
        api: 'openai-responses',
        baseUrl: 'http://example.test'
      }
    ],
    gatewayRequest
  })
  const { baseUrl } = await gateway.start(0)
  let apiKey = ''
  gateway.copyKey((value) => {
    apiKey = value
  })
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
  try {
    expect(await fetch(`${baseUrl}/models`).then((res) => res.status)).toBe(401)
    expect(await fetch(`${baseUrl}/models`, { headers }).then((res) => res.json())).toEqual({
      object: 'list',
      data: [{ id: 'fixture/model', object: 'model', owned_by: 'fixture' }]
    })
    const http = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'fixture/model', stream: true })
    })
    expect(http.headers.get('x-trace-id')).toBe('fixture')
    expect(await http.text()).toContain('response.completed')
    const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/responses`, { headers })
    await once(socket, 'open')
    const message = once(socket, 'message')
    socket.send(JSON.stringify({ type: 'response.create', model: 'fixture/model', input: 'hi' }))
    const [result] = await message
    expect(JSON.parse(String(result))).toEqual({ type: 'response.completed' })
    expect(gatewayRequest).toHaveBeenNthCalledWith(
      2,
      'openai-responses',
      {
        model: 'fixture/model',
        input: 'hi',
        stream: true
      },
      expect.any(Headers),
      expect.any(AbortSignal),
      false
    )
  } finally {
    await gateway.stop()
  }
  expect(gateway.state()).toEqual({ running: false })
})
