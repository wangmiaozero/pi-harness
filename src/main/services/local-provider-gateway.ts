import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { isIP } from 'node:net'
import WebSocket, { WebSocketServer } from 'ws'
import type { LocalGatewayConnection, LocalGatewayState } from '@shared/providers/gateway'
import type { ProviderService } from './provider-service'
import type { ChatGptAccounts } from './chatgpt-accounts'
import { isSelectableChatGptModel } from '@shared/providers/account-management'
import { AppError, ValidationError } from './errors'
import { ProviderQueueError } from './provider-request-queue'

const endpoints = {
  '/v1/chat/completions': 'openai-completions',
  '/v1/responses': 'openai-responses',
  '/v1/responses/compact': 'openai-responses',
  '/v1/messages': 'anthropic-messages'
} as const
const maxBodyBytes = 32 * 1024 * 1024
function isAuthorized(request: IncomingMessage, apiKey: string) {
  const remote = request.socket.remoteAddress
  const host = URL.parse(`http://${request.headers.host ?? ''}`)?.hostname
  if (
    !remote ||
    !isIP(remote) ||
    remote !== '127.0.0.1' ||
    !host ||
    !['localhost', '127.0.0.1'].includes(host)
  )
    return false
  const bearer = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1]
  const supplied = Buffer.from(bearer ?? String(request.headers['x-api-key'] ?? ''))
  const expected = Buffer.from(apiKey)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function requestHeaders(request: IncomingMessage) {
  return new Headers(
    Object.entries(request.headers).flatMap(([name, value]) =>
      typeof value === 'string' ? [[name, value]] : []
    )
  )
}

export class LocalProviderGateway {
  private listener?: ReturnType<typeof createServer>
  private connection?: LocalGatewayConnection
  private apiKey?: string
  private pending?: Promise<LocalGatewayConnection>
  private websockets?: WebSocketServer

  constructor(
    private readonly providers: Pick<ProviderService, 'gatewayModels' | 'gatewayRequest'>,
    private readonly chatGpt?: Pick<ChatGptAccounts, 'list' | 'gatewayRequest'>
  ) {}

  state(): LocalGatewayState {
    return this.connection
      ? { running: true, baseUrl: this.connection.baseUrl }
      : { running: false }
  }

  copyKey(copy: (value: string) => void) {
    if (!this.connection || !this.apiKey) throw new ValidationError('Start the local gateway first')
    copy(this.apiKey)
  }

  start(port: number): Promise<LocalGatewayConnection> {
    if (this.pending) return this.pending
    if (this.connection) return Promise.resolve(this.connection)
    const apiKey = `phg-${randomBytes(32).toString('hex')}`
    const listener = createServer((req, res) => {
      void this.handle(req, res, apiKey).catch((error) => {
        if (res.headersSent) {
          res.destroy()
          return
        }
        const status =
          error instanceof ProviderQueueError
            ? 429
            : error instanceof AppError && error.code === 'VALIDATION_ERROR'
              ? 400
              : 502
        this.json(res, status, {
          error: {
            message: status === 502 ? 'The upstream request could not be completed' : error.message
          }
        })
      })
    })
    const websockets = new WebSocketServer({ noServer: true, maxPayload: maxBodyBytes })
    this.websockets = websockets
    listener.on('upgrade', (request, socket, head) => {
      if (request.url !== '/v1/responses' || !isAuthorized(request, apiKey)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        return
      }
      websockets.handleUpgrade(request, socket, head, (client) =>
        this.handleSocket(client, request)
      )
    })
    this.listener = listener
    this.pending = new Promise<LocalGatewayConnection>((resolve, reject) => {
      listener.once('error', reject)
      listener.listen(port, '127.0.0.1', () => {
        const address = listener.address()
        if (!address || typeof address === 'string')
          return reject(new Error('Gateway address unavailable'))
        const connection = {
          running: true as const,
          baseUrl: `http://127.0.0.1:${address.port}/v1`
        }
        this.apiKey = apiKey
        this.connection = connection
        resolve(connection)
      })
    })
      .catch(() => {
        this.listener = undefined
        this.websockets = undefined
        websockets.close()
        throw new ValidationError('The local gateway could not listen on this port')
      })
      .finally(() => {
        this.pending = undefined
      })
    return this.pending
  }

  async stop(): Promise<void> {
    await this.pending?.catch(() => {})
    const listener = this.listener
    const websockets = this.websockets
    this.websockets = undefined
    websockets?.clients.forEach((client) => client.terminate())
    websockets?.close()
    this.connection = undefined
    this.apiKey = undefined
    this.listener = undefined
    if (!listener) return
    await new Promise<void>((resolve) => {
      listener.close(() => resolve())
      listener.closeAllConnections()
    })
  }

  private json(response: ServerResponse, status: number, value: unknown) {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(value))
  }

  private async handle(request: IncomingMessage, response: ServerResponse, apiKey: string) {
    if (!isAuthorized(request, apiKey)) {
      this.json(response, 401, { error: { message: 'Invalid gateway API key' } })
      return
    }
    if (request.method === 'GET' && request.url === '/v1/models') {
      const models = await this.providers.gatewayModels()
      const accounts = (await this.chatGpt?.list()) ?? []
      const accountModels = accounts
        .filter((account) => !account.routingOnly)
        .flatMap((account) =>
          account.models
            .filter(isSelectableChatGptModel)
            .map((model) => ({ id: `${account.id}/${model.id}`, provider: account.id }))
        )
      this.json(response, 200, {
        object: 'list',
        data: [...models, ...accountModels].map((model) => ({
          id: model.id,
          object: 'model',
          owned_by: model.provider
        }))
      })
      return
    }
    const path = request.url ?? ''
    if (request.method !== 'POST' || !Object.hasOwn(endpoints, path)) {
      this.json(response, 404, { error: { message: 'Unknown gateway endpoint' } })
      return
    }
    const controller = new AbortController()
    response.once('close', () => controller.abort())
    const parts: Buffer[] = []
    let bytes = 0
    for await (const chunk of request) {
      const part = Buffer.from(chunk)
      bytes += part.length
      if (bytes > maxBodyBytes) {
        this.json(response, 413, { error: { message: 'Gateway request is too large' } })
        return
      }
      parts.push(part)
    }
    let payload: unknown
    try {
      payload = JSON.parse(Buffer.concat(parts, bytes).toString('utf8'))
    } catch {
      throw new ValidationError('Expected a JSON request body')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new ValidationError('Expected a JSON request object')
    const upstream = await this.forward(
      endpoints[path as keyof typeof endpoints],
      payload as Record<string, unknown>,
      requestHeaders(request),
      controller.signal,
      path === '/v1/responses/compact'
    )
    const headers = new Headers(upstream.headers)
    for (const name of [
      'content-encoding',
      'content-length',
      'transfer-encoding',
      'set-cookie',
      'connection'
    ])
      headers.delete(name)
    response.writeHead(upstream.status, Object.fromEntries(headers))
    response.flushHeaders()
    if (upstream.body)
      await pipeline(Readable.fromWeb(upstream.body as unknown as NodeReadableStream), response)
    else response.end()
  }

  private forward(
    protocol: (typeof endpoints)[keyof typeof endpoints],
    payload: Record<string, unknown>,
    headers: Headers,
    signal: AbortSignal,
    compact = false
  ) {
    const match =
      typeof payload.model === 'string' &&
      /^(chatgpt-account-[0-9a-f-]{36})\/([A-Za-z0-9._:-]{1,128})$/.exec(payload.model)
    if (match && this.chatGpt) {
      if (protocol !== 'openai-responses' || compact || payload.stream !== true)
        throw new ValidationError('ChatGPT accounts require streaming Responses requests')
      return this.chatGpt.gatewayRequest(match[1], match[2], payload, signal)
    }
    return this.providers.gatewayRequest(protocol, payload, headers, signal, compact)
  }

  private handleSocket(client: WebSocket, request: IncomingMessage) {
    const abort = new AbortController()
    let busy = false
    const report = (message: string, status = 400) => {
      if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify({ type: 'error', status, error: { message } }))
    }
    client.on('error', () => abort.abort())
    client.on('close', () => abort.abort())
    client.on('message', (data, binary) => {
      if (busy || binary) return report('Send one text response.create event at a time')
      busy = true
      void (async () => {
        const { type, stream_id, ...payload } = JSON.parse(data.toString())
        if (type !== 'response.create' || stream_id !== undefined || payload.generate === false)
          return report('Expected a response.create event without a stream ID')
        delete payload.generate
        const response = await this.forward(
          'openai-responses',
          { ...payload, stream: true },
          requestHeaders(request),
          abort.signal
        )
        if (!response.ok || !response.body) {
          await response.body?.cancel()
          return report(`Upstream returned HTTP ${response.status}`, response.status)
        }
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done || abort.signal.aborted) break
            buffer += value
            if (buffer.length > maxBodyBytes) throw new Error('Upstream event is too large')
            let boundary: RegExpExecArray | null
            while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
              const event = buffer
                .slice(0, boundary.index)
                .split(/\r?\n/)
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart())
                .join('\n')
              buffer = buffer.slice(boundary.index + boundary[0].length)
              if (event && event !== '[DONE]')
                await new Promise<void>((resolve, reject) => {
                  client.send(event, (error) => (error ? reject(error) : resolve()))
                })
            }
          }
        } finally {
          await reader.cancel().catch(() => {})
        }
      })()
        .catch((error) => {
          if (error instanceof ProviderQueueError) report(error.message, 429)
          else if (error instanceof AppError && error.code === 'VALIDATION_ERROR')
            report(error.message)
          else if (error instanceof SyntaxError)
            report('Expected a valid response.create JSON event')
          else report('The upstream stream could not be completed', 502)
        })
        .finally(() => {
          busy = false
        })
    })
  }
}
