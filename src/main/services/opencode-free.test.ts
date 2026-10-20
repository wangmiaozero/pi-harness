// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeContext } from '@earendil-works/pi-ai'
import {
  parseCatalog,
  request,
  errorCode,
  BASE,
  DIRECTORY,
  DOCS,
  CONFIG,
  safeErrorCode,
  authorizedAccess,
  GO_BASE,
  GO_DIRECTORY,
  GO_DOCS
} from '../../../resources/desktop-extension/opencode-catalog.mjs'
import {
  createOpenCodeProvider,
  runtimeModels,
  readState,
  sse
} from '../../../resources/desktop-extension/opencode-provider.mjs'
import type { OpenCodeFreeState } from '@shared/providers/opencode-free'
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {}
}))
vi.mock('../security/secret-store', () => ({
  secretStore: {
    getSecret: vi.fn(async () => 'real-user-supplied-test-credential'),
    setSecret: vi.fn(),
    removeSecret: vi.fn()
  }
}))
import { secretStore } from '../security/secret-store'
import {
  initialOpenCodeState,
  OpenCodeFreeService,
  verifyNativeToolRoundtrip
} from './opencode-free-service'

const html =
  '<table><tr><th>Name</th><th>Model ID</th><th>Endpoint</th></tr><tr><td>Big Pickle</td><td>big-pickle</td><td>https://opencode.ai/inference/openai/v1/chat/completions</td></tr><tr><td>Next</td><td>next-free</td><td>https://opencode.ai/inference/openai/v1/chat/completions</td></tr><tr><td>Paid</td><td>paid-free</td><td>https://opencode.ai/inference/openai/v1/chat/completions</td></tr></table><table><tr><th>Model</th><th>Input</th><th>Output</th><th>Cache</th></tr><tr><td>Big Pickle</td><td>Free</td><td>Free</td><td>-</td></tr><tr><td>Next</td><td>Free</td><td>Free</td><td>Free</td></tr><tr><td>Paid</td><td>$1</td><td>$2</td><td>-</td></tr></table>'
const directory = {
  data: ['big-pickle', 'next-free', 'paid-free', 'unknown-free'].map((id) => ({ id }))
}
const entry = {
  id: 'big-pickle',
  name: 'Big Pickle',
  price: 'free' as const,
  available: true,
  api: 'openai-completions' as const,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 32000,
  input: ['text'],
  reasoning: true,
  streaming: 'verified' as const,
  tools: 'verified' as const,
  checkedAt: 1,
  status: 'ready' as const,
  errorCode: null
}
const state = (): OpenCodeFreeState => ({
  ...initialOpenCodeState(),
  enabled: true,
  hasCredential: true,
  authorizedModels: ['big-pickle'],
  refreshedAt: Date.now(),
  models: [entry]
})
const packet = (delta: object, finish_reason: string | null = null) => ({
  choices: [{ index: 0, delta, finish_reason }]
})
const usage = { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } }
function streamResponse(parts: object[], complete = true): Response {
  return new Response(
    parts.map((p) => `data: ${JSON.stringify(p)}\r\n\r\n`).join('') +
      (complete ? 'data: [DONE]\r\n\r\n' : ''),
    { headers: { 'content-type': 'text/event-stream' } }
  )
}
function mockTransport(chat: (init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    if (url === CONFIG)
      return Response.json({
        providers: {
          opencode: { settings: { baseURL: BASE }, models: { 'big-pickle': {}, 'paid-free': {} } }
        }
      })
    if (url === DIRECTORY) return Response.json(directory)
    if (url === DOCS) return new Response(html)
    if (url !== `${BASE}/chat/completions`) throw new Error('Unexpected URL')
    expect(init.redirect).toBe('error')
    return chat(init)
  }) as unknown as typeof fetch
}
const dirs: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe('OpenCode official catalog and transport policy (mock)', () => {
  it('uses prices rather than suffixes, supports dynamic models and preserves retired entries', () => {
    const models = parseCatalog(directory, html, [{ id: 'retired' }])
    expect(models.find((m) => m.id === 'big-pickle')?.price).toBe('free')
    expect(models.find((m) => m.id === 'next-free')?.price).toBe('free')
    expect(models.find((m) => m.id === 'paid-free')?.price).toBe('paid')
    expect(models.find((m) => m.id === 'unknown-free')?.price).toBe('unknown')
    expect(models.find((m) => m.id === 'retired')?.available).toBe(false)
  })
  it('fails closed on duplicate IDs and malformed pricing', () => {
    expect(() => parseCatalog({ data: [{ id: 'a' }, { id: 'a' }] }, html)).toThrow(
      'INVALID_CATALOG'
    )
    expect(() => parseCatalog(directory, '<html>changed</html>')).toThrow('INVALID_PRICING')
    expect(() => parseCatalog({ data: [{ id: '../unsafe' }] }, html)).toThrow('INVALID_CATALOG')
  })
  it.each([
    [401, 'INVALID_API_KEY'],
    [403, 'INSUFFICIENT_PERMISSION'],
    [410, 'MODEL_DEPRECATED'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVICE_UNAVAILABLE']
  ])('normalizes HTTP %s without leaking response bodies', (status, code) => {
    expect(errorCode(status as number)).toBe(code)
  })
  it('identifies official anonymous restrictions', () => {
    expect(errorCode(403, '{"type":"FreeTierError"}')).toBe('FREE_TIER_RESTRICTED')
  })
  it('bounds retries, honors Retry-After and rejects other endpoints', async () => {
    const fetcher = vi.fn(
      async () => new Response('', { status: 429, headers: { 'retry-after': '0' } })
    )
    expect((await request(DIRECTORY, {}, fetcher)).status).toBe(429)
    expect(fetcher).toHaveBeenCalledTimes(3)
    fetcher.mockClear()
    fetcher.mockImplementation(
      async () => new Response('', { status: 429, headers: { 'retry-after': '120' } })
    )
    await request(DIRECTORY, {}, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(request('https://untrusted.invalid/', {}, fetcher)).rejects.toThrow(
      'UNTRUSTED_ENDPOINT'
    )
    const controller = new AbortController()
    controller.abort()
    await expect(request(DIRECTORY, { signal: controller.signal }, fetcher)).rejects.toThrow()
  })
})

describe('OpenCode native Pi provider adapter (mock)', () => {
  it('registers official-key auth and emits actual usage/text', async () => {
    const transport = mockTransport((init) => {
      expect(init.headers).toEqual(
        expect.objectContaining({
          'content-type': 'application/json',
          authorization: 'Bearer real-user-supplied-test-credential',
          'user-agent': 'Pi-Harness'
        })
      )
      return streamResponse([packet({ content: 'O' }), packet({ content: 'K' }, 'stop'), usage])
    })
    const provider = createOpenCodeProvider({
      resolveKey: async () => 'real-user-supplied-test-credential',
      state: async () => state(),
      fetcher: transport
    })
    await provider.refreshModels!({
      allowNetwork: false,
      signal: new AbortController().signal,
      publish: async () => true
    })
    expect(provider.id).toBe('opencode-free')
    expect(
      await provider.auth.apiKey!.resolve({
        ctx: {} as never,
        signal: new AbortController().signal
      })
    ).toEqual({ auth: { apiKey: 'real-user-supplied-test-credential' }, source: 'inference' })
    const model = provider.getModels()[0]
    const events = provider.streamSimple(
      model,
      normalizeContext({ messages: [{ role: 'user', content: 'Hi', timestamp: 1 }] }),
      { apiKey: 'must-not-override-the-current-stored-key' }
    )
    const seen = []
    for await (const event of events) seen.push(event.type)
    expect(seen).toContain('text_delta')
    expect((await events.result()).content).toEqual([{ type: 'text', text: 'OK' }])
    expect((await events.result()).usage.totalTokens).toBe(17)
    expect((await events.result()).provider).toBe('opencode-free')
  })
  it.each(['paid', 'unknown', 'unavailable', 'disabled', 'unverified'])(
    'refuses %s before sending chat data',
    async (kind) => {
      const snapshot = state()
      if (kind === 'paid' || kind === 'unknown') snapshot.models[0] = { ...entry, price: kind }
      if (kind === 'unavailable') snapshot.models[0] = { ...entry, available: false }
      if (kind === 'disabled') snapshot.enabled = false
      if (kind === 'unverified') snapshot.models[0] = { ...entry, tools: 'not_verified' }
      const transport = vi.fn()
      const provider = createOpenCodeProvider({
        resolveKey: async () => 'real-user-supplied-test-credential',
        state: async () => snapshot,
        fetcher: transport
      })
      const events = provider.streamSimple(
        runtimeModels(state())[0],
        normalizeContext({ messages: [] })
      )
      expect((await events.result()).errorMessage).toBe('MODEL_NOT_VERIFIED')
      expect(transport).not.toHaveBeenCalled()
    }
  )
  it('rechecks current prices before each request, rejects repricing and refuses credential-mode without a key', async () => {
    const snapshot = state()
    const transport = mockTransport(() => {
      throw new Error('Chat must not run')
    })
    snapshot.authMode = 'inference'
    const provider = createOpenCodeProvider({
      resolveKey: async () => undefined,
      state: async () => snapshot,
      fetcher: transport
    })
    const events = provider.streamSimple(
      runtimeModels(state())[0],
      normalizeContext({ messages: [] })
    )
    expect((await events.result()).errorMessage).toBe('NOT_CONFIGURED')
    expect(transport).not.toHaveBeenCalled()
    snapshot.authMode = 'inference'
    const changed = vi.fn(async (url) =>
      url === DIRECTORY ? Response.json(directory) : new Response(html.replace(/Free/g, '$1'))
    )
    const guarded = createOpenCodeProvider({
      resolveKey: async () => 'real-user-supplied-test-credential',
      state: async () => snapshot,
      fetcher: changed
    })
    expect(
      (
        await guarded
          .streamSimple(runtimeModels(state())[0], normalizeContext({ messages: [] }))
          .result()
      ).errorMessage
    ).toBe('PAID_AUTHORIZATION_REQUIRED')
    expect(changed).toHaveBeenCalledTimes(2)
  })
  it('rejects truncated streams and missing usage', async () => {
    for (const response of [
      streamResponse([packet({ content: 'partial' })], false),
      streamResponse([packet({ content: 'text' }, 'stop')])
    ]) {
      const provider = createOpenCodeProvider({
        resolveKey: async () => 'real-user-supplied-test-credential',
        state: async () => state(),
        fetcher: mockTransport(() => response)
      })
      const result = await provider
        .streamSimple(runtimeModels(state())[0], normalizeContext({ messages: [] }))
        .result()
      expect(result.stopReason).toBe('error')
      expect(['TRUNCATED_STREAM', 'USAGE_NOT_REPORTED']).toContain(result.errorMessage)
    }
  })
  it('handles split CRLF SSE frames and abort during a response', async () => {
    const bytes = new TextEncoder().encode('data: {"ok":true}\r\n\r\ndata: [DONE]\r\n\r\n')
    const response = new Response(
      new ReadableStream({
        start(c) {
          for (const byte of bytes) c.enqueue(new Uint8Array([byte]))
          c.close()
        }
      }),
      { headers: { 'content-type': 'text/event-stream' } }
    )
    const seen = []
    for await (const frame of sse(response)) seen.push(frame)
    expect(seen).toEqual([{ ok: true }])
    const controller = new AbortController()
    const provider = createOpenCodeProvider({
      resolveKey: async () => 'real-user-supplied-test-credential',
      state: async () => state(),
      fetcher: mockTransport(
        (init) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
            controller.abort()
          })
      )
    })
    const result = await provider
      .streamSimple(runtimeModels(state())[0], normalizeContext({ messages: [] }), {
        signal: controller.signal
      })
      .result()
    expect(result.stopReason).toBe('aborted')
  })
})

describe('OpenCode service and full native Pi tool gate (mock transport, real Pi SDK)', () => {
  it('revokes cached eligibility immediately when inference retires a model before its directory updates', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-retired-'))
    dirs.push(dir)
    const file = path.join(dir, 'state.json')
    await fs.writeFile(file, JSON.stringify(state()))
    const config = {
      read: vi.fn(async () => ({ models: { providers: {} } })),
      patchProvider: vi.fn()
    }
    const service = new OpenCodeFreeService(
      file,
      config as never,
      {} as never,
      mockTransport(() => new Response('{}', { status: 410 }))
    )
    const result = await service.test('big-pickle', { confirmInference: true })
    expect(result.models[0]).toMatchObject({
      available: false,
      status: 'unavailable',
      errorCode: 'MODEL_DEPRECATED'
    })
    expect(runtimeModels(result)).toEqual([])
  })
  it('requires native tool proof beyond HTTP 200, keeps keys out of Pi config, and invalidates proof when auth changes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-auth-'))
    dirs.push(dir)
    const configs: unknown[] = []
    const config = {
      read: vi.fn(async () => ({ models: { providers: { 'opencode-free': { custom: true } } } })),
      patchProvider: vi.fn(async (_id, patch) => {
        configs.push(patch({ custom: true }))
      }),
      setActiveModel: vi.fn()
    }
    const meta = { read: vi.fn(async () => ({ providers: {}, models: {} })), write: vi.fn() }
    let toolsSupported = false
    const transport = mockTransport((init) => {
      expect((init.headers as Record<string, string>).authorization).toBe(
        'Bearer real-user-supplied-test-credential'
      )
      const body = JSON.parse(String(init.body))
      if (!body.stream) return Response.json({ choices: [{ message: { content: 'OK' } }] })
      const result = body.messages.findLast((m: { role: string }) => m.role === 'tool')
      return result
        ? streamResponse([packet({ content: result.content }, 'stop'), usage])
        : toolsSupported
          ? streamResponse([
              packet(
                {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'key-call',
                      type: 'function',
                      function: { name: 'probe_echo', arguments: '{}' }
                    }
                  ]
                },
                'tool_calls'
              ),
              usage
            ])
          : streamResponse([packet({ content: 'HTTP 200 alone is insufficient' }, 'stop'), usage])
    })
    const service = new OpenCodeFreeService(
      path.join(dir, 'state.json'),
      config as never,
      meta as never,
      transport
    )
    await service.configure({
      enabled: true,
      authMode: 'inference',
      apiKey: 'real-user-supplied-test-credential',
      consent: true
    })
    await service.refresh()
    expect(
      (await service.test('big-pickle', { confirmInference: true })).models.find(
        (m) => m.id === 'big-pickle'
      )?.status
    ).toBe('failed')
    toolsSupported = true
    expect(
      (await service.test('big-pickle', { confirmInference: true })).models.find(
        (m) => m.id === 'big-pickle'
      )?.status
    ).toBe('ready')
    await service.select('big-pickle')
    expect(config.setActiveModel).toHaveBeenCalledWith(
      'opencode-free',
      'big-pickle',
      expect.anything()
    )
    expect(configs.some((c) => (c as { models: unknown[] }).models.length === 1)).toBe(true)
    expect(JSON.stringify(configs)).not.toContain('real-user-supplied-test-credential')
    expect(configs.every((c) => (c as { custom: boolean }).custom)).toBe(true)
    const changed = await service.configure({
      enabled: true,
      authMode: 'inference',
      apiKey: 'replacement-test-credential',
      consent: true
    })
    expect(runtimeModels(changed)).toEqual([])
    await expect(service.select('big-pickle')).rejects.toThrow('MODEL_NOT_VERIFIED')
  }, 30000)
  it('supports independent concurrent Pi agents with no shared transcript or tool state', async () => {
    const transport = mockTransport((init) => {
      const body = JSON.parse(String(init.body))
      const result = body.messages.findLast((m: { role: string }) => m.role === 'tool')
      return result
        ? streamResponse([packet({ content: result.content }, 'stop'), usage])
        : streamResponse([
            packet(
              {
                tool_calls: [
                  {
                    index: 0,
                    id: 'multi-call',
                    type: 'function',
                    function: { name: 'probe_echo', arguments: '{}' }
                  }
                ]
              },
              'tool_calls'
            ),
            usage
          ])
    })
    await Promise.all(
      [1, 2].map(() =>
        verifyNativeToolRoundtrip(
          state(),
          entry,
          'real-user-supplied-test-credential',
          new AbortController().signal,
          transport
        )
      )
    )
  }, 30000)
  it('passes the native AgentSession tool/result loop and uses only the official key in authorization headers', async () => {
    const calls: Record<string, unknown>[] = []
    const transport = mockTransport((init) => {
      expect(init.headers).toEqual(
        expect.objectContaining({
          'content-type': 'application/json',
          authorization: 'Bearer real-user-supplied-test-credential',
          'user-agent': 'Pi-Harness'
        })
      )
      const body = JSON.parse(String(init.body))
      calls.push(body)
      const result = body.messages.findLast((m: { role: string }) => m.role === 'tool')
      return result
        ? streamResponse([packet({ content: result.content }, 'stop'), usage])
        : streamResponse([
            packet(
              {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call1',
                    type: 'function',
                    function: { name: 'probe_echo', arguments: '{}' }
                  }
                ]
              },
              'tool_calls'
            ),
            usage
          ])
    })
    await verifyNativeToolRoundtrip(
      state(),
      entry,
      'real-user-supplied-test-credential',
      new AbortController().signal,
      transport
    )
    expect(calls).toHaveLength(2)
    expect(calls[0].model).toBe('big-pickle')
    expect(calls[1].messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'tool', tool_call_id: 'call1' })])
    )
  }, 30000)
  it('persists last successful catalog, never marks HTTP 200 alone verified, and supports offline startup', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-cache-'))
    dirs.push(dir)
    const file = path.join(dir, 'state.json')
    const config = {
      read: vi.fn(async () => ({ models: { providers: {} } })),
      patchProvider: vi.fn(),
      setActiveModel: vi.fn()
    }
    const meta = { read: vi.fn(async () => ({ providers: {}, models: {} })), write: vi.fn() }
    const transport = mockTransport(
      () =>
        new Response(
          JSON.stringify({ error: { type: 'FreeTierError', message: 'sensitive upstream text' } }),
          { status: 403 }
        )
    )
    const service = new OpenCodeFreeService(file, config as never, meta as never, transport)
    expect((await service.state()).authMode).toBe('inference')
    await service.configure({
      enabled: true,
      authMode: 'inference',
      apiKey: 'replacement-test-credential',
      consent: true
    })
    expect((await service.refresh()).models.find((m) => m.id === 'next-free')).toMatchObject({
      price: 'free',
      contextWindow: null,
      status: 'not_verified'
    })
    const tested = await service.test('big-pickle', { confirmInference: true })
    expect(tested.models.find((m) => m.id === 'big-pickle')).toMatchObject({
      status: 'restricted',
      errorCode: 'FREE_TIER_RESTRICTED'
    })
    expect(JSON.stringify(tested)).not.toContain('sensitive upstream text')
    await expect(service.select('big-pickle')).rejects.toThrow('MODEL_NOT_VERIFIED')
    const offline = new OpenCodeFreeService(
      file,
      config as never,
      meta as never,
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    expect((await offline.state()).models).toEqual(tested.models)
    expect((await offline.refresh()).models.map((m) => m.id)).toEqual(
      tested.models.map((m) => m.id)
    )
    expect(runtimeModels(await offline.state())).toEqual([])
    expect((await readState(file)).schemaVersion).toBe(2)
    await fs.writeFile(file, '{broken')
    expect((await readState(file)).enabled).toBe(false)
  })
})

describe('OpenCode user-key migration, authorization and cost consent (mock only)', () => {
  async function fixture(
    fetcher: typeof fetch = mockTransport(() => {
      throw new Error('Unexpected inference')
    })
  ) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-key-'))
    dirs.push(dir)
    const file = path.join(dir, 'state.json')
    const config = {
      read: vi.fn(async () => ({ models: { providers: {} } })),
      patchProvider: vi.fn(),
      setActiveModel: vi.fn()
    }
    const meta = { read: vi.fn(async () => ({ providers: {}, models: {} })), write: vi.fn() }
    return {
      file,
      fetcher,
      config,
      meta,
      service: new OpenCodeFreeService(file, config as never, meta as never, fetcher)
    }
  }
  it('migrates a saved single key without replacing it and reveals only an explicitly owned slot', async () => {
    const f = await fixture()
    await fs.writeFile(f.file, JSON.stringify(state()))
    const writes = vi.mocked(secretStore.setSecret).mock.calls.length
    const result = await f.service.state()
    expect(result.credentials).toEqual([{ id: 'default', name: 'OpenCode' }])
    expect(result.activeCredentialId).toBe('default')
    expect(secretStore.setSecret).toHaveBeenCalledTimes(writes)
    expect(await f.service.revealCredential('default')).toBe('real-user-supplied-test-credential')
    const reads = vi.mocked(secretStore.getSecret).mock.calls.length
    await expect(f.service.revealCredential('../provider')).rejects.toThrow()
    await expect(
      f.service.revealCredential('11111111-1111-1111-1111-111111111111')
    ).rejects.toThrow('CREDENTIAL_NOT_FOUND')
    // An ownership check can read only the active slot, never the requested unknown slot.
    expect(
      vi
        .mocked(secretStore.getSecret)
        .mock.calls.slice(reads)
        .every(([slot]) => slot === 'opencode-free-official')
    ).toBe(true)
    expect(await fs.readFile(`${f.file}.single-key.bak`, 'utf8')).not.toContain(
      'real-user-supplied-test-credential'
    )
  })
  it('isolates named keys, revokes proof on manual switch and never falls back after deletion', async () => {
    const f = await fixture()
    const secrets = new Map<string, string>()
    vi.mocked(secretStore.getSecret).mockImplementation(async (id) => secrets.get(id) ?? null)
    vi.mocked(secretStore.setSecret).mockImplementation(async (id, value) => {
      secrets.set(id, value)
    })
    vi.mocked(secretStore.removeSecret).mockImplementation(async (id) => {
      secrets.delete(id)
    })
    try {
      const first = await f.service.saveCredential({
        name: 'Personal',
        apiKey: 'fixture-one',
        consent: true
      })
      const id1 = first.activeCredentialId!
      expect(first).toMatchObject({ enabled: true, hasCredential: true })
      await fs.writeFile(
        f.file,
        JSON.stringify({
          ...first,
          enabled: true,
          models: [entry],
          refreshedAt: Date.now(),
          authorizedModels: [entry.id],
          allowedPaidModels: [entry.id]
        })
      )
      f.service = new OpenCodeFreeService(f.file, f.config as never, f.meta as never, f.fetcher)
      const second = await f.service.saveCredential({
        name: 'Work',
        apiKey: 'fixture-two',
        consent: true
      })
      const id2 = second.credentials!.find((key) => key.id !== id1)!.id
      expect(second.activeCredentialId).toBe(id1)
      expect(second.models[0].status).toBe('ready')
      const renamed = await f.service.saveCredential({ id: id1, name: 'Renamed', consent: true })
      expect(renamed.models[0].status).toBe('ready')
      expect(await f.service.revealCredential(id2)).toBe('fixture-two')
      const paused = await f.service.configure({
        enabled: false,
        authMode: 'inference',
        consent: true
      })
      expect(paused.enabled).toBe(false)
      expect(runtimeModels(paused)).toEqual([])
      const renamedPaused = await f.service.saveCredential({
        id: id1,
        name: 'Renamed',
        consent: true
      })
      expect(renamedPaused.enabled).toBe(false)
      const resumed = await f.service.activateCredential(id1)
      expect(resumed.enabled).toBe(true)
      expect(resumed.models[0].status).toBe('ready')
      expect(resumed.allowedPaidModels).toEqual([entry.id])
      await f.service.configure({ enabled: false, authMode: 'inference', consent: true })
      const switched = await f.service.activateCredential(id2)
      expect(switched).toMatchObject({
        activeCredentialId: id2,
        enabled: true,
        authorizedModels: [],
        allowedPaidModels: []
      })
      expect(runtimeModels(switched)).toEqual([])
      expect(switched.models[0].streaming).toBe('not_verified')
      expect(secrets.get(`opencode-key-${id1}`)).toBe('fixture-one')
      const deleted = await f.service.deleteCredential(id2)
      expect(deleted).toMatchObject({
        enabled: false,
        hasCredential: false,
        activeCredentialId: null
      })
      expect(deleted.credentials).toEqual([{ id: id1, name: 'Renamed' }])
      expect(secrets.get(`opencode-key-${id1}`)).toBe('fixture-one')
      expect(JSON.stringify(deleted)).not.toContain('fixture-one')
      expect(await fs.readFile(f.file, 'utf8')).not.toContain('fixture-two')
      expect(f.fetcher).not.toHaveBeenCalled()
      expect(f.config.setActiveModel).not.toHaveBeenCalled()
    } finally {
      vi.mocked(secretStore.getSecret).mockImplementation(
        async () => 'real-user-supplied-test-credential'
      )
      vi.mocked(secretStore.setSecret).mockImplementation(async () => undefined)
      vi.mocked(secretStore.removeSecret).mockImplementation(async () => undefined)
    }
  })
  it('coalesces startup and page-entry refreshes into a single account request', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const base = mockTransport(() => {
      throw new Error('Unexpected inference')
    })
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url === CONFIG) await gate
      return base(url, init)
    }) as unknown as typeof fetch
    const f = await fixture(fetcher)
    await fs.writeFile(f.file, JSON.stringify(state()))
    const first = f.service.refresh()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled())
    const second = f.service.refresh()
    expect(second).toBe(first)
    release()
    expect(await first).toEqual(await second)
    expect(vi.mocked(fetcher).mock.calls.filter(([url]) => url === CONFIG)).toHaveLength(1)
  })
  it('cancels before an asynchronous operation acquires its request controller and remains retryable', async () => {
    const f = await fixture()
    await fs.writeFile(f.file, JSON.stringify(state()))
    const pending = f.service.refresh()
    f.service.cancel()
    await expect(pending).rejects.toThrow('REQUEST_CANCELLED')
    expect(f.fetcher).not.toHaveBeenCalled()
    expect((await f.service.refresh()).error).toBeNull()
  })
  it('binds verification approval to the displayed key, price and service before sending requests', async () => {
    for (const [binding, error] of [
      [{ credentialId: '11111111-1111-1111-1111-111111111111' }, 'NOT_VERIFIED'],
      [{ expectedCost: { input: 99, output: 99, cacheRead: 0, cacheWrite: 0 } }, 'PRICE_CHANGED'],
      [{ expectedService: 'go' }, 'NOT_VERIFIED']
    ] as const) {
      const f = await fixture()
      await fs.writeFile(f.file, JSON.stringify(state()))
      const result = await f.service.test(entry.id, {
        confirmInference: true,
        allowPaid: true,
        ...binding
      })
      expect(result.error).toBe(error)
      expect(f.fetcher).not.toHaveBeenCalled()
      expect(runtimeModels(result)).toEqual([])
    }
  })
  it('serializes model selection with credential changes', async () => {
    const f = await fixture()
    await fs.writeFile(f.file, JSON.stringify(state()))
    let finish!: () => void
    f.config.setActiveModel.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const selected = f.service.select('big-pickle')
    await vi.waitFor(() => expect(f.config.setActiveModel).toHaveBeenCalled())
    await expect(f.service.activateCredential('default')).rejects.toThrow('OPERATION_IN_PROGRESS')
    finish()
    expect((await selected).selectedModel).toBe('big-pickle')
  })
  it('persists opt-in workspace visibility independently of provider enablement and runtime proof', async () => {
    const f = await fixture()
    await fs.writeFile(f.file, JSON.stringify(state()))
    expect(await f.service.state()).toMatchObject({ showInWorkspace: false, workspaceModelIds: [] })
    const configured = await f.service.setWorkspaceVisibility({
      showInWorkspace: true,
      modelIds: ['big-pickle', 'big-pickle']
    })
    expect(configured.workspaceModelIds).toEqual(['big-pickle'])
    expect(configured.models[0].status).toBe('ready')
    const restored = new OpenCodeFreeService(f.file, f.config as never, f.meta as never, f.fetcher)
    expect(await restored.state()).toMatchObject({
      showInWorkspace: true,
      workspaceModelIds: ['big-pickle']
    })
    expect(
      await restored.setWorkspaceVisibility({ showInWorkspace: false, modelIds: ['big-pickle'] })
    ).toMatchObject({ enabled: true, showInWorkspace: false, workspaceModelIds: ['big-pickle'] })
    expect(f.config.patchProvider).not.toHaveBeenCalled()
    expect(f.config.setActiveModel).not.toHaveBeenCalled()
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('preserves older choices with missing pricing while enabling a verified model without network requests', async () => {
    const f = await fixture()
    const previousIds = ['minimax-m2.5', 'retired-model']
    await fs.writeFile(
      f.file,
      JSON.stringify({
        ...state(),
        showInWorkspace: true,
        workspaceModelIds: previousIds,
        models: [entry, { ...entry, id: 'minimax-m2.5', price: 'unknown', cost: null }]
      })
    )
    const ids = [...previousIds, 'big-pickle']
    expect(
      await f.service.setWorkspaceVisibility({ showInWorkspace: true, modelIds: ids })
    ).toMatchObject({ workspaceModelIds: ids, showInWorkspace: true })
    const restored = new OpenCodeFreeService(f.file, f.config as never, f.meta as never, f.fetcher)
    expect(
      await restored.setWorkspaceVisibility({ showInWorkspace: false, modelIds: ids })
    ).toMatchObject({ workspaceModelIds: ids, showInWorkspace: false })
    expect(
      await restored.setWorkspaceVisibility({ showInWorkspace: true, modelIds: ['big-pickle'] })
    ).toMatchObject({ workspaceModelIds: ['big-pickle'] })
    await expect(
      restored.setWorkspaceVisibility({ showInWorkspace: true, modelIds: ids })
    ).rejects.toThrow('MODEL_UNAVAILABLE')
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(f.config.patchProvider).not.toHaveBeenCalled()
    expect(f.config.setActiveModel).not.toHaveBeenCalled()
  })
  it('rejects workspace opt-in without a key, unknown models, traversal and arbitrary fields', async () => {
    const f = await fixture()
    await expect(
      f.service.setWorkspaceVisibility({ showInWorkspace: true, modelIds: [] })
    ).rejects.toThrow('NOT_CONFIGURED')
    await expect(
      f.service.setWorkspaceVisibility({ showInWorkspace: false, modelIds: ['unknown'] })
    ).rejects.toThrow('MODEL_UNAVAILABLE')
    await expect(
      f.service.setWorkspaceVisibility({ showInWorkspace: false, modelIds: ['../invalid'] })
    ).rejects.toThrow()
    await expect(
      f.service.setWorkspaceVisibility({
        showInWorkspace: false,
        modelIds: [],
        apiKey: 'not-allowed'
      })
    ).rejects.toThrow()
    expect(await f.service.state()).toMatchObject({ showInWorkspace: false, workspaceModelIds: [] })
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  const configure = {
    enabled: true,
    authMode: 'inference',
    apiKey: 'real-user-supplied-test-credential',
    consent: true
  }
  it('never sends an inference or catalog request when testing without a key; rejects anonymous input', async () => {
    const f = await fixture()
    expect((await f.service.test('connection')).error).toBe('NOT_CONFIGURED')
    expect(f.fetcher).not.toHaveBeenCalled()
    await expect(f.service.configure({ ...configure, authMode: 'anonymous' })).rejects.toThrow()
    await expect(f.service.configure({ ...configure, apiKey: '' })).rejects.toThrow()
    expect((await f.service.state()).hasCredential).toBe(false)
  })
  it('uses authenticated read-only config for connection checks without marking a model READY', async () => {
    const f = await fixture()
    await f.service.configure(configure)
    await f.service.refresh()
    const result = await f.service.test('connection')
    expect(result).toMatchObject({
      connectionStatus: 'CONNECTED',
      httpStatus: 200,
      authorizedModels: ['big-pickle', 'next-free', 'paid-free', 'unknown-free']
    })
    expect(result.models.every((m) => m.status !== 'ready')).toBe(true)
    expect(vi.mocked(f.fetcher).mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
    expect(JSON.stringify(result)).not.toContain(configure.apiKey)
    expect(await fs.readFile(f.file, 'utf8')).not.toContain(configure.apiKey)
    expect(secretStore.setSecret).toHaveBeenCalledWith('opencode-free-official', configure.apiKey, {
      strict: true
    })
  })
  it.each([
    [401, 'INVALID_API_KEY'],
    [403, 'INSUFFICIENT_PERMISSION'],
    [402, 'INSUFFICIENT_BALANCE'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVICE_UNAVAILABLE']
  ] as const)(
    'reports actual HTTP %s, redacts upstream text and revokes previous proof',
    async (status, code) => {
      const fetcher = vi.fn(
        async () =>
          new Response('secret upstream text', { status, headers: { 'retry-after': '120' } })
      ) as unknown as typeof fetch
      const f = await fixture(fetcher)
      await fs.writeFile(f.file, JSON.stringify(state()))
      const result = await f.service.test('connection')
      expect(result).toMatchObject({ error: code, httpStatus: status })
      expect(runtimeModels(result)).toEqual([])
      expect(JSON.stringify(result)).not.toContain('secret upstream text')
    }
  )
  it('deleting a key revokes auth, model proof and paid permission without changing the active model or history', async () => {
    const f = await fixture()
    await fs.writeFile(f.file, JSON.stringify({ ...state(), allowedPaidModels: ['big-pickle'] }))
    const result = await f.service.configure({
      enabled: true,
      authMode: 'inference',
      removeCredential: true,
      consent: true
    })
    expect(result).toMatchObject({
      enabled: false,
      hasCredential: false,
      connectionStatus: 'NOT_CONFIGURED',
      allowedPaidModels: [],
      authorizedModels: []
    })
    expect(runtimeModels(result)).toEqual([])
    expect(secretStore.removeSecret).toHaveBeenCalledWith('opencode-free-official', {
      strict: true
    })
    expect(f.config.setActiveModel).not.toHaveBeenCalled()
    expect((await f.service.test('connection')).error).toBe('NOT_CONFIGURED')
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('preserves old references and backs up metadata once; anonymous state never becomes authenticated', async () => {
    const f = await fixture()
    const old = { ...state(), schemaVersion: 1, authMode: 'anonymous', selectedModel: 'big-pickle' }
    await fs.writeFile(f.file, JSON.stringify(old))
    const migrated = await f.service.state()
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      enabled: false,
      hasCredential: false,
      selectedModel: 'big-pickle',
      authorizedModels: []
    })
    expect(migrated.models[0].id).toBe('big-pickle')
    expect(runtimeModels(migrated)).toEqual([])
    const backup = await fs.readFile(`${f.file}.v1.bak`, 'utf8')
    const next = new OpenCodeFreeService(f.file, f.config as never, f.meta as never, f.fetcher)
    expect(await next.state()).toEqual(migrated)
    expect(await fs.readFile(`${f.file}.v1.bak`, 'utf8')).toBe(backup)
    expect(f.config.patchProvider).not.toHaveBeenCalled()
  })
  it('preserves old official credentials as inference only and requires new proof', async () => {
    const f = await fixture()
    await fs.writeFile(
      f.file,
      JSON.stringify({ ...state(), schemaVersion: 1, authMode: 'official-api-key' })
    )
    const migrated = await f.service.state()
    expect(migrated).toMatchObject({ enabled: true, hasCredential: true, authMode: 'inference' })
    expect(runtimeModels(migrated)).toEqual([])
  })
  it('rejects removed Zen configuration before storing credentials or making requests', async () => {
    const f = await fixture()
    const writes = vi.mocked(secretStore.setSecret).mock.calls.length
    await expect(f.service.configure({ ...configure, authMode: 'zen' })).rejects.toThrow()
    expect(secretStore.setSecret).toHaveBeenCalledTimes(writes)
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('keeps old Zen metadata disabled without resolving its key or using it for inference', async () => {
    const f = await fixture()
    await fs.writeFile(f.file, JSON.stringify({ ...state(), authMode: 'zen' }))
    const reads = vi.mocked(secretStore.getSecret).mock.calls.length
    expect(await f.service.state()).toMatchObject({
      enabled: false,
      hasCredential: false,
      connectionStatus: 'NOT_CONFIGURED'
    })
    expect(secretStore.getSecret).toHaveBeenCalledTimes(reads)
    expect((await f.service.test('connection')).error).toBe('NOT_CONFIGURED')
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('fails without persisting or dispatching when secure storage refuses a credential', async () => {
    const f = await fixture()
    vi.mocked(secretStore.setSecret).mockRejectedValueOnce(
      new Error('Secure credential storage failed')
    )
    await expect(f.service.configure(configure)).rejects.toThrow('Secure credential storage failed')
    expect((await f.service.state()).hasCredential).toBe(false)
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('revokes selection when the catalog expires or account permissions change', async () => {
    const expired = { ...state(), refreshedAt: Date.now() - 86400001 }
    expect(runtimeModels(expired)).toEqual([])
    const cached = await fixture()
    await fs.writeFile(cached.file, JSON.stringify(expired))
    expect((await cached.service.state()).models[0].status).toBe('not_verified')
    const f = await fixture(
      vi.fn(async (url) =>
        url === CONFIG
          ? Response.json({
              providers: { opencode: { disabled: true, settings: { baseURL: BASE }, models: {} } }
            })
          : url === DIRECTORY
            ? Response.json(directory)
            : new Response(html)
      ) as unknown as typeof fetch
    )
    await fs.writeFile(f.file, JSON.stringify(state()))
    expect(runtimeModels(await f.service.refresh())).toEqual([])
  })
  it('never routes non-chat models or trusts arbitrary endpoints from account config', async () => {
    const models = parseCatalog(
      directory,
      html.replaceAll(`${BASE}/chat/completions`, `${BASE}/responses`)
    )
    expect(models.every((m) => m.api === null)).toBe(true)
    const f = await fixture(
      vi.fn(async () =>
        Response.json({
          providers: {
            evil: { settings: { baseURL: 'https://evil.invalid' }, models: { 'big-pickle': {} } }
          }
        })
      ) as unknown as typeof fetch
    )
    await f.service.configure(configure)
    expect((await f.service.test('connection')).authorizedModels).toEqual([])
  })
  it('requires specific paid-model consent and uses real token usage with current price estimates', async () => {
    const transport = mockTransport((init) => {
      const body = JSON.parse(String(init.body))
      if (!body.stream) return Response.json({ choices: [{ message: { content: 'OK' } }] })
      const tool = body.messages.findLast((m: { role: string }) => m.role === 'tool')
      return tool
        ? streamResponse([packet({ content: tool.content }, 'stop'), usage])
        : streamResponse([
            packet(
              {
                tool_calls: [
                  {
                    index: 0,
                    id: 'paid-call',
                    type: 'function',
                    function: { name: 'probe_echo', arguments: '{}' }
                  }
                ]
              },
              'tool_calls'
            ),
            usage
          ])
    })
    const priced = vi.fn(async (url, init) =>
      url === DOCS
        ? new Response(html.replaceAll('<td>Free</td>', '<td>$1</td>'))
        : transport(url, init)
    ) as unknown as typeof fetch
    const f = await fixture(priced)
    await f.service.configure(configure)
    await f.service.refresh()
    expect((await f.service.test('big-pickle', { confirmInference: true })).error).toBe(
      'PAID_AUTHORIZATION_REQUIRED'
    )
    expect(vi.mocked(transport).mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
    expect(
      (await f.service.test('big-pickle', { confirmInference: true, allowPaid: true })).models.find(
        (m) => m.id === 'big-pickle'
      )?.status
    ).toBe('ready')
    const saved = await f.service.state()
    expect(saved.allowedPaidModels).toEqual(['big-pickle'])
    const provider = createOpenCodeProvider({
      state: async () => saved,
      resolveKey: async () => configure.apiKey,
      fetcher: (async (url, init) =>
        url === DOCS
          ? new Response(html.replaceAll('<td>Free</td>', '<td>$1</td>'))
          : mockTransport(() => streamResponse([packet({ content: 'ok' }, 'stop'), usage]))(
              url,
              init
            )) as typeof fetch
    })
    // Cost is an estimate from actual token counts and current official prices.
    const result = await provider
      .streamSimple(runtimeModels(saved)[0], normalizeContext({ messages: [] }))
      .result()
    expect(result.usage.totalTokens).toBe(17)
    expect(result.usage.cost.total).toBeCloseTo(17 / 1e6)
  }, 30000)
})

describe('OpenCode diagnostic allowlist', () => {
  it('does not mistake an uppercase credential for a diagnostic code', () => {
    expect(safeErrorCode(new Error('TEST_UPPERCASE_SECRET'))).toBe('NETWORK_ERROR')
    expect(safeErrorCode(new Error('INVALID_API_KEY'))).toBe('INVALID_API_KEY')
  })
  it('sanitizes arbitrary transport errors before they reach Pi or UI events', async () => {
    const provider = createOpenCodeProvider({
      state: async () => state(),
      resolveKey: async () => 'test-key',
      fetcher: async () => {
        throw new Error('TEST_UPPERCASE_SECRET')
      }
    })
    const output = await provider
      .streamSimple(runtimeModels(state())[0], normalizeContext({ messages: [] }))
      .result()
    expect(output.errorMessage).toBe('NETWORK_ERROR')
    expect(JSON.stringify(output)).not.toContain('TEST_UPPERCASE_SECRET')
  })
})

describe('OpenCode Zen and Go routing (mock accounts, no real keys)', () => {
  const goHtml = html.replaceAll(BASE, GO_BASE)
  function transport(chat: (url: string, init: RequestInit) => Response | Promise<Response>) {
    return vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      if (url === CONFIG)
        return Response.json({
          providers: {
            zen: { settings: { baseURL: BASE }, models: { 'big-pickle': {} } },
            go: {
              settings: { baseURL: GO_BASE },
              headers: { 'x-do-not-forward': 'remote' },
              models: { 'big-pickle': {} }
            },
            untrusted: {
              settings: { baseURL: 'https://untrusted.invalid/' },
              models: { 'unknown-free': {} }
            }
          }
        })
      if (url === DIRECTORY || url === GO_DIRECTORY) return Response.json(directory)
      if (url === DOCS) return new Response(html)
      if (url === GO_DOCS) return new Response(goHtml)
      return chat(String(url), init)
    }) as unknown as typeof fetch
  }
  it('recognizes both services through account config and chooses only the explicit Go route for shared IDs', async () => {
    const fetcher = transport(() => {
      throw new Error('Unexpected inference')
    })
    expect(await authorizedAccess('fixture-key', undefined, fetcher)).toEqual({
      modelIds: ['big-pickle'],
      routes: { 'big-pickle': 'go' }
    })
    expect(vi.mocked(fetcher).mock.calls).toHaveLength(1)
    expect(
      new Headers(vi.mocked(fetcher).mock.calls[0][1]?.headers).get('x-do-not-forward')
    ).toBeNull()
  })
  it('merges sparse V2 built-in overrides with the live default catalogs and honors disabled models', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (url === CONFIG)
        return Response.json({
          providers: {
            opencode: {
              name: 'OpenCode',
              headers: { 'x-opencode-org-id': 'must-not-copy' },
              models: {
                'big-pickle': { disabled: true },
                'paid-free': { package: 'untrusted-package' }
              }
            },
            'opencode-go': { name: 'OpenCode Go', models: {} }
          }
        })
      if (url === DIRECTORY) return Response.json(directory)
      if (url === GO_DIRECTORY) return Response.json({ data: [{ id: 'go-fixture' }] })
      throw new Error('Unexpected request')
    }) as unknown as typeof fetch
    expect(await authorizedAccess('fixture-key', undefined, fetcher)).toEqual({
      modelIds: ['next-free', 'paid-free', 'unknown-free', 'go-fixture'],
      routes: { 'next-free': 'zen', 'paid-free': 'zen', 'unknown-free': 'zen', 'go-fixture': 'go' }
    })
    expect(vi.mocked(fetcher).mock.calls).toHaveLength(3)
  })
  it('does not inherit a catalog for disabled providers, unknown provider IDs or explicit untrusted URLs', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        providers: {
          opencode: { settings: { baseURL: 'https://untrusted.invalid/' }, models: {} },
          'opencode-go': { disabled: true, models: {} },
          other: { models: {} }
        }
      })
    ) as unknown as typeof fetch
    expect((await authorizedAccess('fixture-key', undefined, fetcher)).modelIds).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not parse a Go monthly allowance as a token charge or a free label', () => {
    const pricing =
      '<table><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th><th>Monthly limit</th></tr><tr><td>Big Pickle</td><td>Free</td><td>Free</td><td>Free</td><td>-</td><td>Unlimited</td></tr></table>'
    const models = parseCatalog(
      directory,
      goHtml.split('<table><tr><th>Model</th>')[0] + pricing,
      [],
      'go'
    )
    expect(models.find((model) => model.id === 'big-pickle')).toMatchObject({
      service: 'go',
      price: 'free',
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      api: 'openai-completions'
    })
  })
  it('refreshes the selected key account and revokes cached Zen proof when the account route is Go', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-go-'))
    dirs.push(dir)
    const file = path.join(dir, 'state.json')
    await fs.writeFile(file, JSON.stringify(state()))
    const config = {
      read: vi.fn(async () => ({ models: { providers: {} } })),
      patchProvider: vi.fn(),
      setActiveModel: vi.fn()
    }
    const meta = { read: vi.fn(async () => ({ providers: {}, models: {} })), write: vi.fn() }
    const fetcher = transport(() => {
      throw new Error('Unexpected inference')
    })
    const service = new OpenCodeFreeService(file, config as never, meta as never, fetcher)
    const result = await service.refresh()
    expect(result.authorizedModels).toEqual(['big-pickle'])
    expect(result.models.find((model) => model.id === 'big-pickle')).toMatchObject({
      service: 'go',
      streaming: 'not_verified',
      tools: 'not_verified',
      status: 'not_verified'
    })
    expect(runtimeModels(result)).toEqual([])
    expect(config.setActiveModel).not.toHaveBeenCalled()
    expect(
      vi.mocked(fetcher).mock.calls.every(([url]) => !String(url).endsWith('/chat/completions'))
    ).toBe(true)
  })
  it('verifies Go with the actual native Pi tool/result loop and a stable conversation header', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-go-proof-'))
    dirs.push(dir)
    const file = path.join(dir, 'state.json')
    await fs.writeFile(file, JSON.stringify({ ...state(), models: [{ ...entry, service: 'go' }] }))
    const sessions: string[] = []
    const fetcher = transport((url, init) => {
      expect(url).toBe(`${GO_BASE}/chat/completions`)
      const session = new Headers(init.headers).get('x-opencode-session')
      expect(session).toBeTruthy()
      sessions.push(session!)
      const body = JSON.parse(String(init.body))
      expect(body.stream).toBe(true)
      const result = body.messages.findLast((message: { role: string }) => message.role === 'tool')
      return result
        ? streamResponse([packet({ content: result.content }, 'stop'), usage])
        : streamResponse([
            packet(
              {
                tool_calls: [
                  {
                    index: 0,
                    id: 'go-tool',
                    type: 'function',
                    function: { name: 'probe_echo', arguments: '{}' }
                  }
                ]
              },
              'tool_calls'
            ),
            usage
          ])
    })
    const config = {
      read: vi.fn(async () => ({ models: { providers: {} } })),
      patchProvider: vi.fn(),
      setActiveModel: vi.fn()
    }
    const meta = { read: vi.fn(async () => ({ providers: {}, models: {} })), write: vi.fn() }
    const service = new OpenCodeFreeService(file, config as never, meta as never, fetcher)
    const result = await service.test(entry.id, {
      confirmInference: true,
      credentialId: 'default',
      expectedService: 'go',
      expectedCost: entry.cost
    })
    expect(result.error).toBeNull()
    expect(result.models[0]).toMatchObject({
      service: 'go',
      status: 'ready',
      tools: 'verified',
      streaming: 'verified'
    })
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toBe(sessions[1])
    expect(vi.mocked(fetcher).mock.calls.some(([url]) => url === `${BASE}/chat/completions`)).toBe(
      false
    )
  })
  it('sends Go requests to the Go gateway with its own identity and real session ID, never falling back to Zen', async () => {
    const source = { ...state(), models: [{ ...entry, service: 'go' as const }] }
    const fetcher = transport((url, init) => {
      expect(url).toBe(`${GO_BASE}/chat/completions`)
      expect(new Headers(init.headers).get('user-agent')).toBe('Pi-Harness')
      expect(new Headers(init.headers).get('x-opencode-session')).toBe('fixture-session')
      return new Response('{"_tag":"Forbidden"}', { status: 403 })
    })
    const provider = createOpenCodeProvider({
      state: async () => source,
      fetcher,
      resolveKey: async () => 'fixture-key'
    })
    await provider.refreshModels!({
      allowNetwork: false,
      signal: new AbortController().signal,
      publish: async () => true
    })
    const model = provider.getModels()[0]
    expect(model.baseUrl).toBe(GO_BASE)
    const events = provider.streamSimple(model, normalizeContext({ messages: [] }), {
      sessionId: 'fixture-session'
    })
    for await (const event of events) void event
    expect((await events.result()).errorMessage).toBe('INSUFFICIENT_PERMISSION')
    expect(
      vi.mocked(fetcher).mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))
    ).toHaveLength(1)
    expect(vi.mocked(fetcher).mock.calls.some(([url]) => url === `${BASE}/chat/completions`)).toBe(
      false
    )
  })
})
