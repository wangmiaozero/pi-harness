// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { normalizeContext } from '@earendil-works/pi-ai'
import { IPC_INVOKE } from '@shared/ipc/channels'
import { FREE_PROVIDER_KEY } from '@shared/providers/free-models'
import {
  FreeModelService,
  registerFreeModelHandlers,
  removeLegacyFreeModelGateway
} from './free-model-service'
import type { PiConfigService } from '../../pi/config-service'
import type { PiProviderConfig } from '@shared/types/pi'
import { postKiloStreamed } from './ofm/kilo.js'

const ID = 'kilo/example/coder:free'
const realFetch = globalThis.fetch
const directories: string[] = []
const services: FreeModelService[] = []
const listing = {
  data: [
    { id: 'example/coder:free', isFree: true, supported_parameters: ['tools', 'reasoning'] },
    { id: 'liquid/coder:free', isFree: true, supported_parameters: ['tools', 'reasoning'] },
    { id: 'example/text:free', isFree: true, supported_parameters: [] },
    { id: 'example/paid', isFree: false, supported_parameters: ['tools'] },
    { id: 'example/coder:free', isFree: true, supported_parameters: ['tools'] }
  ]
}

type Body = {
  model: string
  reasoning?: unknown
  messages: Array<{ role: string; content?: string; tool_call_id?: string }>
}
function installFetch(
  options: {
    catalog?: () => Response
    chat?: (body: Body, signal?: AbortSignal | null) => Response | Promise<Response>
  } = {}
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init)
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
    if (url === 'https://ai-gateway.kilo.ai/api/v1/models')
      return options.catalog?.() ?? Response.json(listing)
    if (url === 'https://ai-gateway.kilo.ai/api/v1/chat/completions')
      return options.chat?.(JSON.parse(String(init?.body)), init?.signal) ?? textReply()
    throw new Error('Unexpected network destination')
  })
}

function sse(...chunks: unknown[]): Response {
  return new Response(
    chunks
      .map((event) => 'data: ' + (event === '[DONE]' ? event : JSON.stringify(event)) + '\n\n')
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  )
}

function frame(delta: Record<string, unknown>, finish_reason: string | null = null) {
  return { id: 'fixture', choices: [{ index: 0, delta, finish_reason }] }
}

function textReply() {
  return sse(frame({ reasoning: '推理' }), frame({ content: '你好' }), frame({}, 'stop'), '[DONE]')
}

async function start(options?: Parameters<typeof installFetch>[0], directory?: string) {
  const fetcher = installFetch(options)
  vi.stubGlobal('fetch', fetcher)
  const dir = directory ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'pi-free-models-')))
  if (!directory) directories.push(dir)
  const service = new FreeModelService(dir, () => {})
  services.push(service)
  await service.refresh()
  const registration = (await service.registration(ID))!
  const chat = async (body: Record<string, unknown> = {}, signal?: AbortSignal) =>
    realFetch(registration.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + registration.apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: ID, messages: [], ...body }),
      signal
    })
  return { service, dir, registration, chat, fetcher }
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()))
  vi.unstubAllGlobals()
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

it('validates all free-model IPC requests', async () => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const { service } = await start()
  registerFreeModelHandlers(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    (run) => run(),
    service
  )
  for (const handler of handlers.values())
    await expect(handler(null, { url: 'http://127.0.0.1' })).rejects.toThrow(
      'Invalid free model request'
    )
  await expect(handlers.get(IPC_INVOKE.freeModelsSnapshot)!(null)).resolves.toMatchObject({
    privacyAccepted: false
  })
  await expect(handlers.get(IPC_INVOKE.freeModelsRefresh)!(null)).resolves.toMatchObject({
    catalog: 'ready'
  })
  await expect(handlers.get(IPC_INVOKE.freeModelsAcceptPrivacy)!(null)).resolves.toMatchObject({
    privacyAccepted: true
  })
})

it('requires consent, lists only free rows, and never registers models without tools', async () => {
  const upstream = vi.fn((_body: Body) => textReply())
  const { service, registration, chat } = await start({ chat: upstream })
  expect((await service.snapshot()).models.map((row) => [row.id, row.tools])).toEqual([
    [ID, true],
    ['kilo/liquid/coder:free', true],
    ['kilo/example/text:free', false]
  ])
  expect(registration.models.map((row) => row.id)).toEqual([ID, 'kilo/liquid/coder:free'])
  expect(registration.models[1].thinkingLevelMap.off).toBeNull()
  await expect(service.assertSelectable('opencode/old')).rejects.toThrow('OpenCode client')
  await expect(service.assertSelectable(ID)).rejects.toThrow('privacy notice')
  await expect(service.registration()).resolves.toBeNull()
  expect(
    (await realFetch(registration.baseUrl + '/chat/completions', { method: 'POST' })).status
  ).toBe(401)
  expect((await chat()).status).toBe(403)
  expect(upstream).not.toHaveBeenCalled()
  await service.acceptPrivacy()
  expect((await chat({ model: 'kilo/example/text:free' })).status).toBe(404)
  expect((await chat({ messages: null })).status).toBe(400)
  const response = await chat({ reasoning_effort: 'disabled' })
  expect(await response.text()).toContain('你好')
  expect(upstream.mock.calls[0][0]).toMatchObject({
    model: 'example/coder:free',
    reasoning: { enabled: false }
  })
  expect((await service.snapshot()).models[0].status).toBe('available')
})

it('refuses inference from historical OpenCode model IDs at the loopback gateway', async () => {
  const { service, chat, fetcher } = await start()
  const id = 'opencode/glm-5.3-flash-free'
  await service.acceptPrivacy()
  expect((await service.snapshot()).models.some((model) => model.id === id)).toBe(false)
  expect((await service.registration())?.models.some((model) => model.id === id)).toBe(false)
  expect((await service.registration(id))?.models.some((model) => model.id === id)).toBe(true)
  await expect(service.assertSelectable(id)).rejects.toThrow('OpenCode client')
  const rejected = await chat({ model: id, messages: [{ role: 'user', content: 'private' }] })
  expect(rejected.status).toBe(403)
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    'https://ai-gateway.kilo.ai/api/v1/models'
  ])
})

it('caps Dots3 output even when a session still sends the old catalog limit', async () => {
  const id = 'dots-studio/dots-3-note-preview:free'
  const upstream = vi.fn((_body: Body) => textReply())
  const { service, chat } = await start({
    catalog: () =>
      Response.json({
        data: [
          {
            id,
            isFree: true,
            supported_parameters: ['tools'],
            context_length: 512_000,
            top_provider: { max_completion_tokens: 460_800 }
          }
        ]
      }),
    chat: upstream
  })
  await service.acceptPrivacy()
  expect((await service.registration())?.models).toEqual([
    expect.objectContaining({ id: `kilo/${id}`, contextWindow: 512_000, maxTokens: 262_144 })
  ])
  const response = await chat({ model: `kilo/${id}`, max_tokens: 460_800 })
  expect(await response.text()).toContain('你好')
  const smaller = await chat({ model: `kilo/${id}`, max_tokens: 512 })
  expect(await smaller.text()).toContain('你好')
  expect(upstream.mock.calls.map(([body]) => body)).toEqual([
    expect.objectContaining({ model: id, max_tokens: 262_144 }),
    expect.objectContaining({ model: id, max_tokens: 512 })
  ])
})

it('uses the native Pi parser for thinking, tools and history across two turns', async () => {
  const upstream = vi.fn((body: Body) =>
    body.messages.some((message) => message.role === 'tool')
      ? textReply()
      : sse(
          frame({
            tool_calls: [
              {
                id: 'call_read',
                index: 0,
                type: 'function',
                function: { name: 'read', arguments: '{"path":' }
              }
            ]
          }),
          frame({ tool_calls: [{ index: 0, function: { arguments: '"demo.txt"}' } }] }),
          frame({}, 'tool_calls'),
          '[DONE]'
        )
  )
  const { service, registration } = await start({ chat: upstream })
  await service.acceptPrivacy()
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })
  runtime.registerProvider(FREE_PROVIDER_KEY, registration)
  const model = runtime.getModel(FREE_PROVIDER_KEY, ID)!
  const user = { role: 'user', content: '请读取 demo.txt', timestamp: Date.now() } as const
  const context = {
    messages: [user],
    tools: [{ name: 'read', description: 'Read a file', parameters: { type: 'object' } }]
  }
  const first = await runtime
    .streamSimple(model, normalizeContext(context), { reasoning: 'low' })
    .result()
  expect(first).toMatchObject({
    model: ID,
    provider: FREE_PROVIDER_KEY,
    stopReason: 'toolUse',
    content: [{ type: 'toolCall', id: 'call_read', name: 'read', arguments: { path: 'demo.txt' } }]
  })
  const stream = runtime.streamSimple(
    model,
    normalizeContext({
      ...context,
      messages: [
        user,
        first,
        {
          role: 'toolResult',
          toolCallId: 'call_read',
          toolName: 'read',
          content: [{ type: 'text', text: '文件内容' }],
          isError: false,
          timestamp: Date.now()
        }
      ]
    })
  )
  const events = []
  for await (const event of stream) events.push(event.type)
  expect(events).toContain('text_delta')
  expect(await stream.result()).toMatchObject({
    stopReason: 'stop',
    content: [
      { type: 'thinking', thinking: '推理' },
      { type: 'text', text: '你好' }
    ]
  })
  expect(upstream.mock.calls[0][0].reasoning).toEqual({ effort: 'low' })
  expect(upstream.mock.calls[1][0].messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: '请读取 demo.txt' }),
      expect.objectContaining({ role: 'tool', content: '文件内容', tool_call_id: 'call_read' })
    ])
  )
})

it.each([
  [401, 'sign in', 'unavailable'],
  [403, 'not available in your region', 'region'],
  [404, 'missing model', 'unavailable'],
  [402, 'insufficient balance', 'quota'],
  [429, 'rate limit', 'limited'],
  [500, 'upstream broke', 'upstream']
])(
  'classifies HTTP %s and applies Retry-After to anonymous throttling',
  async (status, message, state) => {
    const upstream = vi.fn((_body: Body) =>
      Response.json({ error: { message } }, { status, headers: { 'retry-after': '30' } })
    )
    const { service, chat } = await start({ chat: upstream })
    await service.acceptPrivacy()
    expect((await chat()).status).toBe(status)
    expect((await service.snapshot()).models[0].status).toBe(state)
    if (status === 429) {
      const blocked = await chat({ model: 'kilo/liquid/coder:free' })
      expect(blocked.status).toBe(429)
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(upstream).toHaveBeenCalledTimes(1)
    }
  }
)

it.each([frame({ content: 'partial' }), { error: { code: 500, message: 'terminated' } }])(
  'reports truncated or erroneous SSE rather than verifying the model',
  async (ending) => {
    const { service, chat } = await start({ chat: () => sse(frame({ content: 'first' }), ending) })
    await service.acceptPrivacy()
    const text = await (await chat()).text()
    expect(text).toContain('event: error')
    expect(text).not.toContain('[DONE]')
    expect((await service.snapshot()).models[0].status).toBe('upstream')
  }
)

it('cancels an in-flight request when the local caller aborts', async () => {
  let enter!: () => void
  let abort!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const aborted = new Promise<void>((resolve) => {
    abort = resolve
  })
  const { service, chat } = await start({
    chat: (_body, signal) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener(
          'abort',
          () => {
            abort()
            reject(signal!.reason)
          },
          { once: true }
        )
        enter()
      })
  })
  await service.acceptPrivacy()
  const controller = new AbortController()
  const response = chat({}, controller.signal).catch((error: unknown) => error)
  await entered
  controller.abort()
  expect(await response).toMatchObject({ name: 'AbortError' })
  await aborted
  expect((await service.snapshot()).models[0].status).toBe('unverified')
})

it('recovers the cache and consent after a restart when discovery fails', async () => {
  const first = await start()
  await first.service.acceptPrivacy()
  await (await first.chat()).text()
  await first.service.stop()
  const next = await start(
    {
      catalog: () => {
        throw new TypeError('offline')
      }
    },
    first.dir
  )
  const snapshot = await next.service.snapshot()
  expect(snapshot).toMatchObject({ stale: true, privacyAccepted: true, catalog: 'offline' })
  expect(snapshot.models[0]).toMatchObject({ id: ID, status: 'unverified' })
})

it('keeps native compaction signals for a rejected long conversation', async () => {
  const { service, chat } = await start({
    chat: () =>
      Response.json(
        {
          error: { code: 'context_length_exceeded', message: 'The context includes fixture data' }
        },
        { status: 400 }
      )
  })
  await service.acceptPrivacy()
  const result = await chat()
  expect(result.status).toBe(400)
  expect(await result.json()).toEqual({
    error: { message: 'The request exceeds the context window' }
  })
  expect((await service.snapshot()).models[0].status).toBe('unverified')
})

it('aborts a stalled upstream before headers arrive', async () => {
  const onAbort = vi.fn()
  vi.stubGlobal(
    'fetch',
    installFetch({
      chat: (_body, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener(
            'abort',
            () => {
              onAbort()
              reject(signal!.reason)
            },
            { once: true }
          )
        })
    })
  )
  await expect(
    postKiloStreamed({
      body: {},
      onData: () => {},
      timeoutMs: 15
    })
  ).rejects.toMatchObject({ code: 'TIMEOUT' })
  expect(onAbort).toHaveBeenCalledOnce()
})

it('removes only the generated loopback configuration from the previous integration', async () => {
  let provider: PiProviderConfig | undefined = {
    api: 'openai-completions',
    apiKey: 'A'.repeat(32),
    baseUrl: 'http://127.0.0.1:3210/v1',
    models: [{ id: 'kilo/example/coder:free' }, { id: 'opencode/old' }]
  }
  const patch = vi.fn(
    async (
      _key: string,
      update: (value: PiProviderConfig | undefined) => PiProviderConfig | undefined
    ) => {
      provider = update(provider)
    }
  )
  const config = {
    read: async () => ({ models: { providers: { [FREE_PROVIDER_KEY]: provider } } }),
    patchProvider: patch
  } as unknown as PiConfigService
  await removeLegacyFreeModelGateway(config)
  expect(provider).toBeUndefined()
  provider = { apiKey: 'manual', baseUrl: 'https://example.test/v1', models: [{ id: 'custom' }] }
  await removeLegacyFreeModelGateway(config)
  expect(patch).toHaveBeenCalledOnce()
  expect(provider.apiKey).toBe('manual')
})
