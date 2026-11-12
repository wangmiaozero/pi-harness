// @vitest-environment node
import { normalizeContext } from '@earendil-works/pi-ai'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { afterEach, expect, it, vi } from 'vitest'
import {
  chatGptProviderSync,
  createChatGptProvider
} from '../../../resources/desktop-extension/chatgpt-provider.mjs'
import type { ChatGptAccount } from '@shared/providers/account-management'

afterEach(() => vi.unstubAllGlobals())

const nativeModel = openaiProvider()
  .getModels()
  .find(({ api }) => api === 'openai-responses')!
const account: ChatGptAccount = {
  id: 'chatgpt-account-493957de-923a-4681-b5b6-d8de350c293a',
  label: '293a',
  status: 'authorized',
  models: [
    {
      id: nativeModel.id,
      name: nativeModel.name,
      reasoning: nativeModel.reasoning,
      vision: false,
      verified: true
    }
  ]
}

it('runs the Pi Responses streaming and tool-call path on the account model', async () => {
  const tool = {
    type: 'function_call',
    id: 'fc_fixture',
    call_id: 'call_fixture',
    name: 'read',
    arguments: ''
  }
  const final = { ...tool, arguments: '{"path":"README.md"}' }
  const payloads = [
    { type: 'response.output_item.added', output_index: 0, item: tool },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: final.arguments },
    { type: 'response.output_item.done', output_index: 0, item: final },
    {
      type: 'response.completed',
      response: {
        id: 'resp_fixture',
        status: 'completed',
        output: [final],
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          total_tokens: 16,
          input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 }
        }
      }
    }
  ]
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe('https://api.openai.com/v1/responses')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-chatgpt-access')
    expect(init?.redirect).toBe('error')
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ model: nativeModel.id, stream: true, store: false })
    expect(body).not.toHaveProperty('max_output_tokens')
    return new Response(
      payloads.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
      {
        headers: { 'content-type': 'text/event-stream' }
      }
    )
  })
  vi.stubGlobal('fetch', fetcher)
  const provider = createChatGptProvider(account, async () => 'fixture-chatgpt-access')
  const runtime = await ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    credentials: {
      async read() {
        return undefined
      },
      async list() {
        return []
      },
      async modify() {
        throw new Error('unexpected credential mutation')
      },
      async delete() {
        throw new Error('unexpected credential deletion')
      }
    }
  })
  runtime.registerNativeProvider(provider)
  const model = runtime.getModel(account.id, nativeModel.id)!
  expect(model?.provider).toBe(account.id)
  const stream = runtime.streamSimple(
    model,
    {
      messages: [{ role: 'user', content: 'Read the fixture', timestamp: Date.now() }]
    },
    { maxTokens: 128 }
  )
  const types = []
  for await (const event of stream) types.push(event.type)
  expect(types).toContain('toolcall_delta')
  expect(await stream.result()).toMatchObject({
    provider: account.id,
    stopReason: 'toolUse',
    usage: { input: 7, output: 4, cacheRead: 3, cacheWrite: 2 },
    content: [{ type: 'toolCall', name: 'read', arguments: { path: 'README.md' } }]
  })
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('registers only verified account models and unregisters revoked accounts', async () => {
  const register = vi.fn()
  const unregister = vi.fn()
  let accounts = [{ ...account, models: [{ ...account.models[0], verified: false }] }]
  const sync = chatGptProviderSync(
    register,
    unregister,
    async () => accounts,
    async () => 'fixture'
  )
  await sync()
  expect(register).not.toHaveBeenCalled()
  accounts = [account]
  await sync()
  await sync()
  expect(register).toHaveBeenCalledTimes(1)
  accounts = []
  await sync()
  expect(unregister).toHaveBeenCalledExactlyOnceWith(account.id)

  const provider = createChatGptProvider(account, async () => {
    throw new Error('private token')
  })
  const result = await provider
    .streamSimple(provider.getModels()[0], normalizeContext({ messages: [] }))
    .result()
  expect(result).toMatchObject({ provider: account.id, stopReason: 'error' })
  expect(result.errorMessage).not.toContain('private token')
})
