import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { chatGptVerifySchema } from '@shared/schemas/ipc'
import type { ChatGptAccounts } from '../services/chatgpt-accounts'
import type { ProviderService } from '../services/provider-service'
import { providerKeySchema } from '@shared/schemas/domain'
import { ProviderQueueError } from '../services/provider-request-queue'

// Pi can send ten 10 MiB images in one turn, plus earlier conversation context.
const maxRequestBytes = 256 * 1024 * 1024

export class ChatGptResponsesBridge {
  private readonly googleRoutes = new Map<string, { key: string; baseUrl: string }>()
  private readonly token = randomBytes(32).toString('hex')
  private endpoint?: Promise<{ url: string; token: string }>
  private readonly server = createServer((request, response) => {
    void this.forward(request, response).catch((error) => {
      if (response.headersSent) response.destroy()
      else {
        const status = error instanceof ProviderQueueError ? 429 : 502
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            error: {
              message: status === 429 ? error.message : 'Provider request could not be completed.'
            }
          })
        )
      }
    })
  })
  private closed = false

  constructor(
    private readonly accounts?: Pick<ChatGptAccounts, 'fetchResponses'>,
    private readonly fetchProvider?: ProviderService['runtimeFetch']
  ) {}

  start(): Promise<{ url: string; token: string }> {
    if (this.closed) return Promise.reject(new Error('ChatGPT connection closed'))
    return (this.endpoint ??= new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address()
        if (!address || typeof address === 'string')
          return reject(new Error('ChatGPT connection unavailable'))
        resolve({ url: `http://127.0.0.1:${address.port}/responses`, token: this.token })
      })
    }))
  }

  async close(): Promise<void> {
    this.closed = true
    if (!this.endpoint) return
    await this.endpoint.catch(() => {})
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve())
      this.server.closeAllConnections()
    })
  }

  async googleBaseUrl(key: string, baseUrl: string): Promise<string> {
    const { url } = await this.start()
    const existing = [...this.googleRoutes].find(
      ([, route]) => route.key === key && route.baseUrl === baseUrl
    )
    const routeId = existing?.[0] ?? randomBytes(32).toString('hex')
    if (!existing) {
      if (this.googleRoutes.size >= 256)
        this.googleRoutes.delete(this.googleRoutes.keys().next().value!)
      this.googleRoutes.set(routeId, { key, baseUrl })
    }
    return new URL(`/google/${routeId}`, url).href
  }

  private async forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const google =
      /^\/google\/([0-9a-f]{64})(\/models\/[^/?]+:(?:streamGenerateContent|generateContent))(\?[^#]*)?$/.exec(
        request.url ?? ''
      )
    if (request.method === 'POST' && google) {
      const route = this.googleRoutes.get(google[1])
      if (!route || !this.fetchProvider) {
        response.writeHead(404).end()
        return
      }
      return this.forwardGoogle(request, response, route, google[2], google[3])
    }
    const supplied = Buffer.from(request.headers.authorization ?? '')
    const expected = Buffer.from(`Bearer ${this.token}`)
    if (
      request.method !== 'POST' ||
      (request.url !== '/responses' && request.url !== '/provider') ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      response.writeHead(404).end()
      return
    }
    const generic = request.url === '/provider'
    const input = chatGptVerifySchema.safeParse({
      id: request.headers['x-chatgpt-account'],
      modelId: request.headers['x-chatgpt-model']
    })
    const length = Number(request.headers['content-length'])
    if (
      (!generic && !input.success) ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > maxRequestBytes
    ) {
      response.writeHead(400).end()
      return
    }
    const controller = new AbortController()
    response.once('close', () => controller.abort())
    const chunks: Buffer[] = []
    let received = 0
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk)
      received += bytes.length
      if (received > length) {
        response.writeHead(400).end()
        return
      }
      chunks.push(bytes)
    }
    if (received !== length || controller.signal.aborted) return
    const body = Buffer.concat(chunks, received)
    if (generic) {
      const key = providerKeySchema.safeParse(request.headers['x-provider-key'])
      const target = request.headers['x-provider-target']
      const base = request.headers['x-provider-base']
      const encodedHeaders = request.headers['x-provider-headers']
      if (
        !this.fetchProvider ||
        !key.success ||
        typeof target !== 'string' ||
        typeof base !== 'string' ||
        typeof encodedHeaders !== 'string'
      ) {
        response.writeHead(400).end()
        return
      }
      const headers = new Headers(JSON.parse(Buffer.from(encodedHeaders, 'base64url').toString()))
      for (const name of [
        'host',
        'connection',
        'content-length',
        'transfer-encoding',
        'proxy-authorization',
        'cookie'
      ])
        headers.delete(name)
      const upstream = await this.fetchProvider(key.data, base, target, {
        method: 'POST',
        headers,
        body: new Uint8Array(body),
        signal: controller.signal
      })
      return this.send(response, upstream, true)
    }
    if (!input.success || !this.accounts) {
      response.writeHead(404).end()
      return
    }
    const { id, modelId } = input.data
    let payload: unknown
    try {
      payload = JSON.parse(body.toString('utf8'))
    } catch {
      response.writeHead(400).end()
      return
    }
    const params = payload as { model?: string; stream?: boolean; store?: boolean } | null
    if (params?.model !== modelId || params.stream !== true || params.store !== false) {
      response.writeHead(400).end()
      return
    }
    const upstream = await this.accounts.fetchResponses(id, modelId, {
      body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      signal: controller.signal
    })
    return this.send(response, upstream, false)
  }

  private async forwardGoogle(
    request: IncomingMessage,
    response: ServerResponse,
    route: { key: string; baseUrl: string },
    path: string,
    query = ''
  ) {
    const abort = new AbortController()
    response.once('close', () => abort.abort())
    const parts: Buffer[] = []
    let bytes = 0
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > maxRequestBytes) {
        response.writeHead(413).end()
        return
      }
      parts.push(buffer)
    }
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) {
      if (
        typeof value === 'string' &&
        /^(?:authorization|x-[\w-]+|content-type|accept|user-agent)$/i.test(name)
      )
        headers.set(name, value)
    }
    const target = new URL(route.baseUrl)
    target.pathname = target.pathname.replace(/\/+$/, '') + path
    target.search = query
    const upstream = await this.fetchProvider!(route.key, route.baseUrl, target, {
      method: 'POST',
      headers,
      body: new Uint8Array(Buffer.concat(parts, bytes)),
      signal: abort.signal
    })
    return this.send(response, upstream, true)
  }

  private async send(response: ServerResponse, upstream: Response, includeHeaders: boolean) {
    const headers: Record<string, string> = {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store'
    }
    if (includeHeaders) {
      for (const [name, value] of upstream.headers) {
        headers[name] = value
      }
    }
    response.writeHead(upstream.status, headers)
    response.flushHeaders()
    if (upstream.body)
      await pipeline(Readable.fromWeb(upstream.body as unknown as NodeReadableStream), response)
    else response.end()
  }
}
