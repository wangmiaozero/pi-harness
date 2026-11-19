// @vitest-environment node
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import type { PiProviderConfig } from '@shared/types/pi'
import type { ProviderMeta } from './metadata-store'
import { ProviderService } from './provider-service'
import { resolveLoginShellProxyEnvironment } from '../environment/command-resolver'
import { bypassesProxy, isLocalProxyTarget } from './provider-proxy-environment'

vi.mock('../environment/command-resolver', () => ({
  resolveLoginShellProxyEnvironment: vi.fn()
}))

const electron = vi.hoisted(() => ({
  resolveProxy: vi.fn<(url: string) => Promise<string>>(),
  fromPartition: vi.fn<
    (
      name: string,
      options: { cache: boolean }
    ) => {
      setProxy: (settings: Electron.ProxyConfig) => Promise<void>
      fetch: typeof fetch
    }
  >()
}))
vi.mock('electron', () => ({
  app: {},
  session: {
    defaultSession: { resolveProxy: electron.resolveProxy },
    fromPartition: electron.fromPartition
  }
}))

function service(
  providers: Record<string, PiProviderConfig>,
  metadata: Record<string, ProviderMeta>
) {
  return new ProviderService(
    { read: async () => ({ models: { providers } }) } as never,
    { read: async () => ({ providers: metadata, models: {} }) } as never
  )
}

async function listen(server: ReturnType<typeof createServer>) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

it('keeps runtime, probe and gateway proxy decisions bound to the same provider', async () => {
  const customRequests: (string | undefined)[] = []
  const directRequests: (string | undefined)[] = []
  const proxy = createServer((request, response) => {
    customRequests.push(request.headers.authorization)
    request.resume()
    response
      .writeHead(401, { 'content-type': 'application/json' })
      .end('{"error":{"message":"fixture"}}')
  })
  const target = createServer((request, response) => {
    directRequests.push(request.headers.authorization)
    request.resume()
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end('{"choices":[{"message":{"content":"OK"}}]}')
  })
  const proxyOrigin = await listen(proxy)
  const baseUrl = `${await listen(target)}/v1`
  const endpoint = `${baseUrl}/chat/completions`
  const modes: Electron.ProxyConfig[] = []
  electron.fromPartition.mockImplementation(() => {
    let proxyRules: string | undefined
    return {
      setProxy: async (settings: Electron.ProxyConfig) => {
        modes.push(settings)
        proxyRules = settings.proxyRules
      },
      fetch: (input, init) =>
        fetch(proxyRules === 'http://127.0.0.1:7890' ? proxyOrigin : input, init)
    }
  })
  const provider = (apiKey: string) => ({ apiKey, baseUrl, models: [{ id: 'fixture' }] })
  const providers = service(
    {
      proxied: provider('fixture-proxy-key'),
      direct: provider('fixture-direct-key')
    },
    {
      proxied: { advanced: { proxy: { mode: 'custom', url: 'http://127.0.0.1:7890' } } },
      direct: { advanced: { proxy: { mode: 'direct' } } }
    }
  )
  try {
    const [proxied, direct] = await Promise.all([
      providers.testConnection({ providerKey: 'proxied' }),
      providers.testConnection({ providerKey: 'direct' })
    ])
    expect(proxied).toMatchObject({
      status: 'auth_error',
      httpStatus: 401,
      network: {
        proxyMode: 'custom',
        transport: 'electron_fetch',
        proxyRoute: 'http://127.0.0.1:7890'
      }
    })
    expect(direct).toMatchObject({
      status: 'success',
      httpStatus: 200,
      network: { proxyMode: 'direct', transport: 'electron_fetch', proxyRoute: 'DIRECT' }
    })
    for (const key of ['proxied', 'direct']) {
      const headers = {
        authorization: `Bearer fixture-${key === 'proxied' ? 'proxy' : 'direct'}-key`
      }
      const response = await providers.runtimeFetch(key, baseUrl, endpoint, {
        method: 'POST',
        headers
      })
      await response.body?.cancel()
      const gateway = await providers.gatewayRequest(
        'openai-completions',
        { model: `${key}/fixture` },
        new Headers(),
        new AbortController().signal
      )
      await gateway.body?.cancel()
    }
    expect(modes).toHaveLength(2)
    expect(modes).toContainEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: '<-loopback>'
    })
    expect(modes).toContainEqual({ mode: 'direct' })
    expect(customRequests).toEqual(Array(3).fill('Bearer fixture-proxy-key'))
    expect(directRequests).toEqual(Array(3).fill('Bearer fixture-direct-key'))
  } finally {
    await Promise.all([close(proxy), close(target)])
  }
})

it('uses the WebSocket transport and HTTP proxy for configured streaming Responses', async () => {
  const proxy = createServer()
  const ws = new WebSocketServer({ server: proxy })
  const proxyOrigin = await listen(proxy)
  const baseUrl = 'http://upstream.invalid/v1'
  const handshakes: string[] = []
  const requests: unknown[] = []
  ws.on('connection', (client, request) => {
    handshakes.push(request.url ?? '')
    client.on('message', (message) => {
      requests.push(JSON.parse(message.toString()))
      client.send('{"type":"response.completed","response":{"id":"resp-fixture"}}')
    })
  })
  electron.resolveProxy.mockResolvedValueOnce(`PROXY ${new URL(proxyOrigin).host}; DIRECT`)
  const providers = service(
    {
      fixture: { api: 'openai-responses', baseUrl, models: [{ id: 'fixture' }] }
    },
    {
      fixture: { advanced: { responsesWebSocket: true, proxy: { mode: 'system' } } }
    }
  )
  try {
    const diagnostic = await providers.testConnection({ providerKey: 'fixture' })
    expect(diagnostic).toMatchObject({
      status: 'success',
      httpStatus: 101,
      endpoint: 'ws://upstream.invalid/v1/responses',
      network: { proxyMode: 'system', transport: 'responses_websocket', proxyRoute: proxyOrigin }
    })
    expect(electron.resolveProxy).toHaveBeenLastCalledWith('ws://upstream.invalid/v1/responses')
    expect(handshakes).toEqual(['http://upstream.invalid/v1/responses'])
    expect(requests).toEqual([
      { type: 'response.create', model: 'fixture', max_output_tokens: 16, input: 'ping' }
    ])
    electron.resolveProxy.mockResolvedValueOnce('SOCKS5 127.0.0.1:7890')
    await expect(providers.testConnection({ providerKey: 'fixture' })).resolves.toMatchObject({
      status: 'protocol_error',
      httpStatus: null,
      network: { proxyRoute: 'socks5://127.0.0.1:7890' }
    })
    expect(handshakes).toHaveLength(1)
  } finally {
    ws.clients.forEach((socket) => socket.terminate())
    ws.close()
    await close(proxy)
  }
})

it('recovers refused tool chats through Responses only when the gateway switch is on', async () => {
  const paths: string[] = []
  const target = createServer((request, response) => {
    paths.push(request.url ?? '')
    request.resume()
    if (request.url === '/v1/responses') {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(
          '{"id":"r1","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"OK"}]}]}'
        )
      return
    }
    response
      .writeHead(400, { 'content-type': 'application/json' })
      .end(
        `{"error":{"message":"Function tools with reasoning_effort are not supported for fixture in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.","type":"invalid_request_error","param":"reasoning_effort","code":null}}`
      )
  })
  const baseUrl = `${await listen(target)}/v1`
  electron.fromPartition.mockImplementation(() => ({
    setProxy: async () => {},
    fetch: (input, init) => fetch(input, init)
  }))
  const provider = { apiKey: 'fixture-key', baseUrl, models: [{ id: 'fixture' }] }
  const providers = service(
    { on: provider, off: provider },
    {
      on: { gateway: true, advanced: { proxy: { mode: 'direct' } } },
      off: { advanced: { proxy: { mode: 'direct' } } }
    }
  )
  const body = new TextEncoder().encode(
    JSON.stringify({
      model: 'fixture',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }]
    })
  )
  const chat = (key: string) =>
    providers.runtimeFetch(key, baseUrl, `${baseUrl}/chat/completions`, { method: 'POST', body })
  try {
    const off = await chat('off')
    expect(off.status).toBe(400)
    await off.body?.cancel()
    expect(paths).toEqual(['/v1/chat/completions'])

    const on = await chat('on')
    expect(on.status).toBe(200)
    expect(await on.json()).toMatchObject({
      object: 'chat.completion',
      choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }]
    })
    expect(paths.slice(1)).toEqual(['/v1/chat/completions', '/v1/responses'])
  } finally {
    await close(target)
  }
})

it('sends OpenAI GPT requests at the priority tier only while Fast is on', async () => {
  const bodies: unknown[] = []
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    bodies.push(await new Response(init?.body).json())
    return new Response('{}', { headers: { 'content-type': 'application/json' } })
  })
  electron.fromPartition.mockImplementation(() => ({
    setProxy: async () => {},
    fetch: (input, init) => fetch(input, init)
  }))
  const baseUrl = 'https://api.openai.com/v1'
  const metadata = {
    fastMode: false,
    providers: { openai: { advanced: { proxy: { mode: 'direct' } } } },
    models: {}
  }
  const providers = new ProviderService(
    {
      read: async () => ({
        models: { providers: { openai: { baseUrl, models: [{ id: 'gpt-6.2-sol' }] } } }
      })
    } as never,
    { read: async () => metadata } as never
  )
  const send = (model: string) =>
    providers
      .runtimeFetch('openai', baseUrl, `${baseUrl}/responses`, {
        method: 'POST',
        body: new TextEncoder().encode(JSON.stringify({ model, input: 'hi' }))
      })
      .then((response) => response.body?.cancel())

  try {
    await send('gpt-6.2-sol')
    metadata.fastMode = true
    await send('gpt-6.2-sol')
    await send('text-embedding-3-large')
  } finally {
    fetcher.mockRestore()
  }
  expect(bodies).toEqual([
    { model: 'gpt-6.2-sol', input: 'hi' },
    { model: 'gpt-6.2-sol', input: 'hi', service_tier: 'priority' },
    { model: 'text-embedding-3-large', input: 'hi' }
  ])
})

it('rejects invalid proxy rules from legacy metadata before any transport runs', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch')
  const providers = service(
    { fixture: { baseUrl: 'http://fixture.invalid/v1', models: [{ id: 'fixture' }] } },
    { fixture: { advanced: { proxy: { mode: 'custom', url: 'http://invalid,host:7890' } } } }
  )
  try {
    await expect(providers.testConnection({ providerKey: 'fixture' })).resolves.toMatchObject({
      status: 'proxy_error',
      httpStatus: null,
      network: { proxyMode: 'custom', transport: null }
    })
    expect(fetcher).not.toHaveBeenCalled()
  } finally {
    fetcher.mockRestore()
  }
})

it('takes a process proxy ahead of the system route and only reads the shell when needed', async () => {
  const resolveLoginEnv = vi.mocked(resolveLoginShellProxyEnvironment)
  resolveLoginEnv.mockResolvedValue({ HTTPS_PROXY: 'http://shell-proxy.invalid:8080' })
  const providers = service(
    {
      fixture: {
        baseUrl: 'https://fixture.invalid/v1',
        api: 'openai-responses',
        models: [{ id: 'fixture' }]
      }
    },
    {}
  )
  electron.fromPartition.mockImplementation(() => ({
    setProxy: async () => {},
    fetch: async () => new Response(null, { status: 401 })
  }))
  for (const key of [
    'https_proxy',
    'HTTPS_PROXY',
    'all_proxy',
    'ALL_PROXY',
    'NO_PROXY',
    'no_proxy'
  ])
    vi.stubEnv(key, undefined)
  const probe = () => providers.testConnection({ providerKey: 'fixture' })
  try {
    const resolvedBefore = electron.resolveProxy.mock.calls.length
    vi.stubEnv('HTTPS_PROXY', 'http://environment-proxy.invalid:8080')
    await expect(probe()).resolves.toMatchObject({
      status: 'auth_error',
      network: {
        automaticProxySource: 'environment',
        proxyRoute: 'http://environment-proxy.invalid:8080'
      }
    })
    expect(electron.resolveProxy).toHaveBeenCalledTimes(resolvedBefore)
    expect(resolveLoginEnv).not.toHaveBeenCalled()
    vi.stubEnv('HTTPS_PROXY', undefined)
    electron.resolveProxy.mockResolvedValueOnce('PROXY system-proxy.invalid:8080; DIRECT')
    await expect(probe()).resolves.toMatchObject({
      status: 'auth_error',
      network: { automaticProxySource: 'system', proxyRoute: 'http://system-proxy.invalid:8080' }
    })
    expect(resolveLoginEnv).not.toHaveBeenCalled()
    electron.resolveProxy.mockResolvedValueOnce('DIRECT')
    await expect(probe()).resolves.toMatchObject({
      status: 'auth_error',
      network: {
        automaticProxySource: 'login_shell',
        proxyRoute: 'http://shell-proxy.invalid:8080'
      }
    })
    expect(resolveLoginEnv).toHaveBeenCalledOnce()
    await expect(providers.runtimeProviders()).resolves.toEqual([
      { key: 'fixture', protocol: 'openai-responses' }
    ])
    await expect(
      providers.runtimeSettings('fixture', 'https://fixture.invalid/v1')
    ).resolves.toEqual({})
  } finally {
    vi.unstubAllEnvs()
  }
})

it('keeps loopback and private destinations local and honors host, port and CIDR bypass rules', () => {
  for (const target of [
    'http://localhost.',
    'http://127.20.10.7',
    'http://[::1]',
    'http://192.168.8.3',
    'http://router.local'
  ])
    expect(isLocalProxyTarget(new URL(target))).toBe(true)
  expect(isLocalProxyTarget(new URL('https://public.invalid'))).toBe(false)
  const env = { NO_PROXY: 'internal.test:8443,203.0.113.0/24,[::1]' }
  expect(bypassesProxy(new URL('https://api.internal.test:8443'), env)).toBe(true)
  expect(bypassesProxy(new URL('https://api.internal.test'), env)).toBe(false)
  expect(bypassesProxy(new URL('https://other-internal.test:8443'), env)).toBe(false)
  expect(bypassesProxy(new URL('https://203.0.113.100'), env)).toBe(true)
  expect(bypassesProxy(new URL('https://[::1]'), env)).toBe(true)
})
