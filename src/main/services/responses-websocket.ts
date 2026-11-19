import WebSocket from 'ws'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'

export class ResponsesWebSocketError extends Error {
  constructor(readonly kind: 'invalid_response' | 'model_error' | 'connection_timeout') {
    super(kind)
  }
}

export function fetchResponsesWebSocket(
  url: URL,
  headers: HeadersInit | undefined,
  payload: Record<string, unknown>,
  signal: AbortSignal,
  proxy?: string
): Promise<Response> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const address = new URL(url)
    address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:'
    const agent = proxy
      ? new (address.protocol === 'wss:' ? HttpsAgent : HttpAgent)({
          proxyEnv: proxy === 'direct' ? {} : { HTTPS_PROXY: proxy, HTTP_PROXY: proxy }
        })
      : undefined
    const outgoing = new Headers(headers)
    outgoing.delete('content-type')
    outgoing.delete('accept')
    outgoing.delete('content-length')
    const ws = new WebSocket(address, {
      headers: Object.fromEntries(outgoing),
      handshakeTimeout: 20_000,
      maxPayload: 16 * 1024 * 1024,
      followRedirects: false,
      agent
    })
    const { stream: _stream, background: _background, ...request } = payload
    const encoder = new TextEncoder()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    let ended = false
    const stop = (error?: unknown) => {
      if (ended) return
      ended = true
      signal.removeEventListener('abort', abort)
      if (error) {
        if (controller) controller.error(error)
        else reject(error)
      } else controller?.close()
      ws.terminate()
      agent?.destroy()
    }
    const abort = () => stop(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    ws.on('error', (error) =>
      stop(
        error.message === 'Opening handshake has timed out'
          ? new ResponsesWebSocketError('connection_timeout')
          : error
      )
    )
    ws.on('close', () => stop(new ResponsesWebSocketError('invalid_response')))
    ws.on('unexpected-response', (_request, response) => {
      const status = response.statusCode ?? 502
      const body = [204, 205, 304].includes(status)
        ? null
        : JSON.stringify({ error: { message: `WebSocket handshake returned HTTP ${status}` } })
      resolve(new Response(body, { status, headers: { 'content-type': 'application/json' } }))
      response.resume()
      stop()
    })
    ws.on('open', () => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          controller = stream
        },
        pull() {
          ws.resume()
        },
        cancel() {
          stop()
        }
      })
      resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
      ws.send(JSON.stringify({ ...request, type: 'response.create' }), (error) => {
        if (error) stop(error)
      })
    })
    ws.on('message', (data) => {
      if (ended || !controller) return
      const text = data.toString()
      let event: { type?: string; error?: { message?: string } }
      try {
        event = JSON.parse(text)
        if (!event || typeof event.type !== 'string')
          throw new Error('Invalid Responses WebSocket event')
      } catch {
        stop(new ResponsesWebSocketError('invalid_response'))
        return
      }
      if (event.type === 'error') {
        stop(new ResponsesWebSocketError('model_error'))
        return
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      if (
        ['response.completed', 'response.failed', 'response.incomplete'].includes(event.type ?? '')
      )
        stop()
      else if ((controller.desiredSize ?? 0) <= 0) ws.pause()
    })
  })
}
