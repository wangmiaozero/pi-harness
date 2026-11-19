import { describe, expect, it } from 'vitest'
import {
  chatToResponses,
  responsesToChatCompletion,
  sendChatThroughGateway,
  type ChatGatewayRoute
} from './provider-chat-gateway'

const toolsRefusal = JSON.stringify({
  error: {
    message:
      'Function tools with reasoning_effort are not supported for gpt-6.2-sol in /v1/chat/completions. Please use /v1/responses or set reasoning_effort to "none".',
    type: 'invalid_request_error'
  }
})
const noneRefusal = JSON.stringify({
  error: {
    message: "Unsupported value: 'none'. Supported values are: 'low', 'medium', and 'high'."
  }
})

const chatPayload = (stream: boolean) => ({
  model: 'gpt-6.2-sol',
  stream,
  stream_options: { include_usage: true },
  reasoning_effort: 'high',
  max_completion_tokens: 4096,
  messages: [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: [{ type: 'text', text: 'Read a file' }] },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } }
      ]
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'file body' }
  ],
  tools: [
    {
      type: 'function',
      function: { name: 'read', description: 'Read', parameters: { type: 'object' }, strict: false }
    }
  ]
})

const sse = (events: unknown[]) =>
  new Response(events.map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  })

function harness(answers: ((url: string, body: Record<string, unknown>) => Response)[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const send = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    calls.push({ url, body })
    const answer = answers.shift()
    if (!answer) throw new Error(`unexpected request to ${url}`)
    return answer(url, body)
  }
  return { calls, send }
}

const refuse = (body: string) => () => new Response(body, { status: 400 })
const url = new URL('https://api.openai.com/v1/chat/completions')
const gatewayRequest = (
  payload: Record<string, unknown>,
  routes = new Map<string, ChatGatewayRoute>()
) => ({ url, init: { body: JSON.stringify(payload) }, payload, routes, routeKey: 'openai' })

describe('chat gateway', () => {
  it('translates a chat request into Responses input', () => {
    expect(chatToResponses(chatPayload(true))).toEqual({
      model: 'gpt-6.2-sol',
      stream: true,
      store: false,
      input: [
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'Be brief.' }]
        },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Read a file' }] },
        { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{"path":"a"}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'file body' }
      ],
      tools: [
        {
          type: 'function',
          name: 'read',
          description: 'Read',
          parameters: { type: 'object' },
          strict: false
        }
      ],
      reasoning: { effort: 'high', summary: 'auto' },
      max_output_tokens: 4096
    })
  })

  it('streams the Responses reply back as chat chunks and remembers the route', async () => {
    const routes = new Map<string, ChatGatewayRoute>()
    const reply = () =>
      sse([
        { type: 'response.created', response: { id: 'r1', model: 'gpt-6.2-sol', created_at: 1 } },
        { type: 'response.reasoning_summary_text.delta', delta: 'think' },
        { type: 'response.output_text.delta', delta: 'Hi' },
        {
          type: 'response.output_item.added',
          item: { type: 'function_call', id: 'fc_1', call_id: 'call_2', name: 'read' }
        },
        { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"path":' },
        { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '"b"}' },
        {
          type: 'response.output_item.done',
          item: { type: 'function_call', id: 'fc_1', arguments: '{"path":"b"}' }
        },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
              input_tokens_details: { cached_tokens: 4 },
              output_tokens_details: { reasoning_tokens: 2 }
            }
          }
        }
      ])
    const { calls, send } = harness([refuse(toolsRefusal), reply, reply])
    const request = { ...gatewayRequest(chatPayload(true), routes), send }
    const response = await sendChatThroughGateway(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const data = (await response.text())
      .split('\n\n')
      .filter(Boolean)
      .map((event) => event.replace(/^data: /, ''))
    expect(data.at(-1)).toBe('[DONE]')
    const chunks = data.slice(0, -1).map((event) => JSON.parse(event))
    expect(chunks.every((chunk) => chunk.id === 'chatcmpl-r1')).toBe(true)
    expect(chunks.map((chunk) => chunk.choices[0]?.delta ?? null)).toEqual([
      { role: 'assistant', content: '' },
      { reasoning_content: 'think' },
      { content: 'Hi' },
      {
        tool_calls: [
          { index: 0, id: 'call_2', type: 'function', function: { name: 'read', arguments: '' } }
        ]
      },
      { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '"b"}' } }] },
      {},
      null
    ])
    expect(chunks.at(-2).choices[0].finish_reason).toBe('tool_calls')
    expect(chunks.at(-1).usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 4 },
      completion_tokens_details: { reasoning_tokens: 2 }
    })
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/v1/chat/completions',
      '/v1/responses'
    ])

    await (await sendChatThroughGateway(request)).text()
    expect(calls.map((call) => new URL(call.url).pathname).slice(2)).toEqual(['/v1/responses'])
  })

  it('translates a non-streaming Responses reply', () => {
    expect(
      responsesToChatCompletion(
        {
          id: 'r2',
          created_at: 7,
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'partial' }] }]
        },
        'gpt-6.2-sol'
      )
    ).toMatchObject({
      id: 'chatcmpl-r2',
      object: 'chat.completion',
      model: 'gpt-6.2-sol',
      choices: [{ message: { role: 'assistant', content: 'partial' }, finish_reason: 'length' }]
    })
  })

  it('turns reasoning off when the provider has no Responses endpoint', async () => {
    const { calls, send } = harness([
      refuse(toolsRefusal),
      () => new Response('not found', { status: 404 }),
      () => new Response('{"ok":true}', { status: 200 })
    ])
    const response = await sendChatThroughGateway({ ...gatewayRequest(chatPayload(false)), send })
    expect(await response.json()).toEqual({ ok: true })
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/v1/chat/completions',
      '/v1/responses',
      '/v1/chat/completions'
    ])
    expect(calls.map((call) => call.body.reasoning_effort)).toEqual(['high', undefined, 'none'])
  })

  it('returns the original refusal once the model also refuses none', async () => {
    const routes = new Map<string, ChatGatewayRoute>()
    const notFound = () => new Response('', { status: 404 })
    const first = harness([refuse(toolsRefusal), notFound, refuse(noneRefusal)])
    const request = gatewayRequest(chatPayload(false), routes)
    const response = await sendChatThroughGateway({ ...request, send: first.send })
    expect(response.status).toBe(400)
    expect(await response.text()).toBe(toolsRefusal)
    expect(routes.get('openai')).toBe('effort-kept')

    const again = harness([refuse(toolsRefusal), notFound])
    expect((await sendChatThroughGateway({ ...request, send: again.send })).status).toBe(400)
    expect(again.calls).toHaveLength(2)
  })

  it('passes other requests and errors through unchanged', async () => {
    const plain = harness([() => new Response('ok', { status: 200 })])
    const { tools: _tools, ...withoutTools } = chatPayload(false)
    await sendChatThroughGateway({ ...gatewayRequest(withoutTools), send: plain.send })
    expect(plain.calls).toHaveLength(1)

    const effortNone = harness([refuse(toolsRefusal)])
    const effortOff = { ...chatPayload(false), reasoning_effort: 'none' }
    expect(
      (await sendChatThroughGateway({ ...gatewayRequest(effortOff), send: effortNone.send })).status
    ).toBe(400)
    expect(effortNone.calls).toHaveLength(1)

    const other = harness([refuse('{"error":{"message":"bad key"}}')])
    const response = await sendChatThroughGateway({
      ...gatewayRequest(chatPayload(false)),
      send: other.send
    })
    expect(await response.text()).toBe('{"error":{"message":"bad key"}}')
    expect(other.calls).toHaveLength(1)
  })
})
