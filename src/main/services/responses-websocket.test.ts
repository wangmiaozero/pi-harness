// @vitest-environment node
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import { expect, it } from 'vitest'
import { fetchResponsesWebSocket } from './responses-websocket'

it('converts a Responses WebSocket stream to the event stream Pi expects', async () => {
  const server = createServer()
  const websocket = new WebSocketServer({ server })
  let received: unknown
  websocket.on('connection', (socket) => {
    socket.once('message', (message) => {
      received = JSON.parse(message.toString())
      socket.send(JSON.stringify({ type: 'response.output_text.delta', delta: 'fixture' }))
      socket.send(JSON.stringify({ type: 'response.completed' }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const { port } = server.address() as { port: number }
    const response = await fetchResponsesWebSocket(
      new URL(`http://127.0.0.1:${port}/v1/responses`),
      { authorization: 'Bearer fixture' },
      { model: 'fixture', stream: true, input: 'hello' },
      AbortSignal.timeout(5_000)
    )
    expect(await response.text()).toContain('response.completed')
    expect(received).toEqual({ type: 'response.create', model: 'fixture', input: 'hello' })
  } finally {
    websocket.clients.forEach((socket) => socket.terminate())
    websocket.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
