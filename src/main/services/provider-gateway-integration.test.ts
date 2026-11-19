// @vitest-environment node
import { once } from 'node:events'
import { createServer, get } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it, vi } from 'vitest'
import type { PiProviderConfig } from '@shared/types/pi'
import type { ModelMeta } from './metadata-store'
import { LocalProviderGateway } from './local-provider-gateway'
import { ProviderService } from './provider-service'

vi.mock('electron', () => ({ app: {}, safeStorage: { isEncryptionAvailable: () => false } }))

it('routes native models and credentials, reflects configuration changes and aborts an upstream stream', async () => {
  const requests: {
    path: string
    authorization?: string
    tenant?: string
    payload: Record<string, unknown>
  }[] = []
  let disconnected!: () => void
  const upstreamDisconnected = new Promise<void>((resolve) => {
    disconnected = resolve
  })
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const payload = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
    requests.push({
      path: request.url ?? '',
      authorization: request.headers.authorization,
      tenant: request.headers['x-tenant-id'] as string | undefined,
      payload
    })
    if (payload.input === 'disconnect') {
      response.once('close', disconnected)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"type":"response.created"}\n\n')
      return
    }
    if (payload.input === 'exception') {
      response.destroy()
      return
    }
    if (payload.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"type":"response.completed","response":{"id":"resp-fixture"}}\n\n')
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ received: payload.model }))
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const baseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`
  const providers: Record<string, PiProviderConfig> = {
    'custom-responses': {
      baseUrl,
      api: 'openai-responses',
      apiKey: 'fixture-responses-key',
      headers: { 'x-tenant-id': 'responses-tenant' },
      models: [{ id: 'vendor/model' }, { id: 'chat-override', api: 'openai-completions' }]
    },
    'custom-chat': {
      baseUrl,
      apiKey: 'fixture-chat-key',
      models: [{ id: 'vendor/model' }]
    },
    'custom-messages': { baseUrl, api: 'anthropic-messages', models: [{ id: 'vendor/model' }] },
    gemini: { baseUrl, api: 'google-generative-ai', models: [{ id: 'fixture' }] },
    invalid: {
      baseUrl: 'http://user:fixture-private-password@localhost/v1',
      models: [{ id: 'fixture' }]
    }
  }
  const models: Record<string, Partial<ModelMeta>> = {}
  const service = new ProviderService(
    { read: async () => ({ models: { providers } }) } as never,
    {
      read: async () => ({
        models,
        providers: {
          'custom-responses': {
            advanced: { concurrency: 1, nativeCompaction: true, extraBody: { fixture: true } }
          }
        }
      })
    } as never
  )
  const gateway = new LocalProviderGateway(service)
  const { baseUrl: gatewayUrl } = await gateway.start(0)
  providers.recursive = {
    baseUrl: gatewayUrl.replace('127.0.0.1', 'localhost.'),
    models: [{ id: 'fixture' }]
  }
  let key = ''
  gateway.copyKey((value) => {
    key = value
  })
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  const catalog = async () => (await fetch(`${gatewayUrl}/models`, { headers })).json()
  const post = (path: string, model: string, fields = {}, signal?: AbortSignal) =>
    fetch(`${gatewayUrl}/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, ...fields }),
      signal
    })
  try {
    expect(new URL(gatewayUrl).hostname).toBe('127.0.0.1')
    const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
      get(
        `${gatewayUrl}/models`,
        { headers: { ...headers, host: 'untrusted.example' } },
        (response) => {
          response.resume()
          resolve(response.statusCode)
        }
      ).on('error', reject)
    })
    expect(foreignHost).toBe(401)
    expect(
      await fetch(`${gatewayUrl}/models`, { headers: { authorization: 'Bearer wrong' } }).then(
        (response) => response.status
      )
    ).toBe(401)
    expect(await catalog()).toEqual({
      object: 'list',
      data: [
        {
          id: 'custom-responses/vendor/model',
          object: 'model',
          owned_by: 'custom-responses',
          supported_protocols: ['openai-responses']
        },
        {
          id: 'custom-responses/chat-override',
          object: 'model',
          owned_by: 'custom-responses',
          supported_protocols: ['openai-completions']
        },
        {
          id: 'custom-chat/vendor/model',
          object: 'model',
          owned_by: 'custom-chat',
          supported_protocols: ['openai-completions']
        },
        {
          id: 'custom-messages/vendor/model',
          object: 'model',
          owned_by: 'custom-messages',
          supported_protocols: ['anthropic-messages']
        }
      ]
    })
    const state = await gateway.status()
    expect(state.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gemini/fixture', unavailable: 'unsupported_protocol' }),
        expect.objectContaining({ id: 'invalid/fixture', unavailable: 'invalid_endpoint' }),
        expect.objectContaining({ id: 'recursive/fixture', unavailable: 'recursive_upstream' })
      ])
    )
    expect(JSON.stringify(state)).not.toMatch(/fixture-(?:responses-key|chat-key|private-password)/)
    const badProtocol = await post('responses', 'custom-chat/vendor/model')
    expect(badProtocol.status).toBe(400)
    expect(await badProtocol.json()).toMatchObject({ error: { code: 'unsupported_protocol' } })
    const recursive = await post('chat/completions', 'recursive/fixture')
    expect(await recursive.json()).toMatchObject({ error: { code: 'recursive_upstream' } })
    expect(requests).toHaveLength(0)
    const responses = await post('responses', 'custom-responses/vendor/model', {
      stream: true,
      input: [{ role: 'user', content: 'fixture' }],
      tools: [{ type: 'function', name: 'fixture' }]
    })
    expect(await responses.text()).toContain('resp-fixture')
    expect(await (await post('chat/completions', 'custom-chat/vendor/model')).json()).toEqual({
      received: 'vendor/model'
    })
    expect(await (await post('messages', 'custom-messages/vendor/model')).json()).toEqual({
      received: 'vendor/model'
    })
    expect(await (await post('responses/compact', 'custom-responses/vendor/model')).json()).toEqual(
      { received: 'vendor/model' }
    )
    expect(requests).toEqual([
      expect.objectContaining({
        path: '/v1/responses',
        authorization: 'Bearer fixture-responses-key',
        tenant: 'responses-tenant',
        payload: {
          model: 'vendor/model',
          fixture: true,
          stream: true,
          input: [{ role: 'user', content: 'fixture' }],
          tools: [{ type: 'function', name: 'fixture' }]
        }
      }),
      expect.objectContaining({
        path: '/v1/chat/completions',
        authorization: 'Bearer fixture-chat-key',
        tenant: undefined
      }),
      expect.objectContaining({ path: '/v1/messages', authorization: undefined }),
      expect.objectContaining({ path: '/v1/responses/compact', payload: { model: 'vendor/model' } })
    ])

    const controller = new AbortController()
    const stream = await post(
      'responses',
      'custom-responses/vendor/model',
      { input: 'disconnect', stream: true },
      controller.signal
    )
    const reader = stream.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('response.created')
    controller.abort()
    await upstreamDisconnected
    expect(
      (await post('responses', 'custom-responses/vendor/model', { input: 'exception' })).status
    ).toBe(502)
    expect((await post('responses', 'custom-responses/vendor/model')).status).toBe(200)

    models['custom-chat::vendor/model'] = { enabled: false }
    expect((await catalog()).data.map((entry: { id: string }) => entry.id)).not.toContain(
      'custom-chat/vendor/model'
    )
    expect(await (await post('chat/completions', 'custom-chat/vendor/model')).json()).toMatchObject(
      { error: { code: 'disabled' } }
    )
    providers['custom-chat'].models = []
    expect(await (await post('chat/completions', 'custom-chat/vendor/model')).json()).toMatchObject(
      { error: { code: 'model_not_found' } }
    )
  } finally {
    await gateway.stop()
    await new Promise<void>((resolve) => {
      upstream.close(() => resolve())
      upstream.closeAllConnections()
    })
  }
})
