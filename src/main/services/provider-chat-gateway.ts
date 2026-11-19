/**
 * Recovers Chat Completions requests that an upstream refuses because it will not
 * combine function tools with reasoning_effort (OpenAI reasoning models on /chat/completions).
 * The request is re-sent to the same provider's Responses endpoint and the reply is
 * translated back to Chat Completions; without Responses, reasoning is turned off.
 */

import { randomUUID } from 'node:crypto'

type Json = Record<string, unknown>

export type ChatGatewayRoute = 'responses' | 'effort-kept'

export interface ChatGatewayRequest {
  url: URL
  init: RequestInit
  payload: Json
  routes: Map<string, ChatGatewayRoute>
  routeKey: string
  send: (url: string, init: RequestInit) => Promise<Response>
}

const toolsWithoutEffort =
  /tools with reasoning_effort are not supported[\s\S]*reasoning_effort to \W{0,3}none/i
const effortLevelsNamed = /\blow\b\W+(?:medium|high)\b/i

const record = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** An omitted reasoning_effort still gets the model's default effort upstream. */
export function chatAsksToolEffort(payload: Json) {
  return list(payload.tools).length > 0 && payload.reasoning_effort !== 'none'
}

export async function sendChatThroughGateway(request: ChatGatewayRequest): Promise<Response> {
  const { url, init, payload, routes, routeKey, send } = request
  if (!chatAsksToolEffort(payload)) return send(url.href, init)
  if (routes.get(routeKey) === 'responses') {
    const answered = await viaResponses(request)
    if (answered) return answered
    routes.delete(routeKey)
  }

  const first = await send(url.href, init)
  if (first.status !== 400) return first
  const refusal = await first.text()
  const refused = () =>
    new Response(refusal, {
      status: first.status,
      statusText: first.statusText,
      headers: first.headers
    })
  if (!toolsWithoutEffort.test(refusal)) return refused()

  const answered = await viaResponses(request)
  if (answered) {
    routes.set(routeKey, 'responses')
    return answered
  }
  if (routes.get(routeKey) === 'effort-kept') return refused()

  const off = await send(url.href, withBody(init, { ...payload, reasoning_effort: 'none' }))
  if (off.status !== 400) return off
  const offBody = await off.text()
  if (effortLevelsNamed.test(offBody)) {
    routes.set(routeKey, 'effort-kept')
    return refused()
  }
  return new Response(offBody, {
    status: off.status,
    statusText: off.statusText,
    headers: off.headers
  })
}

async function viaResponses({ url, init, payload, send }: ChatGatewayRequest) {
  const target = new URL(url.href)
  target.pathname = target.pathname.replace(/\/chat\/completions$/, '/responses')
  const response = await send(target.href, withBody(init, chatToResponses(payload)))
  if (response.status === 404 || response.status === 405) {
    await response.body?.cancel()
    return
  }
  const headers = new Headers()
  for (const name of ['retry-after', 'request-id', 'x-request-id']) {
    const value = response.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (!response.ok) {
    headers.set('content-type', response.headers.get('content-type') ?? 'application/json')
    return new Response(response.body, { status: response.status, headers })
  }
  const model = text(payload.model)
  if (payload.stream === true && response.body) {
    headers.set('content-type', 'text/event-stream; charset=utf-8')
    return new Response(response.body.pipeThrough(responsesToChatStream(model)), {
      status: 200,
      headers
    })
  }
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(responsesToChatCompletion(await response.json(), model)), {
    status: 200,
    headers
  })
}

function withBody(init: RequestInit, body: Json): RequestInit {
  const headers = new Headers(init.headers)
  headers.delete('content-length')
  headers.set('content-type', 'application/json')
  return { ...init, headers, body: JSON.stringify(body) }
}

function contentParts(content: unknown, assistant: boolean) {
  const kind = assistant ? 'output_text' : 'input_text'
  if (typeof content === 'string') return content ? [{ type: kind, text: content }] : []
  return list(content).flatMap((raw): Json[] => {
    const part = record(raw)
    if (part.type === 'text' && text(part.text)) return [{ type: kind, text: part.text }]
    if (assistant) return []
    if (part.type === 'image_url') {
      const image = part.image_url
      const url = typeof image === 'string' ? image : text(record(image).url)
      return url
        ? [{ type: 'input_image', image_url: url, detail: text(record(image).detail) || 'auto' }]
        : []
    }
    if (part.type === 'file') {
      const file = record(part.file)
      if (text(file.file_id)) return [{ type: 'input_file', file_id: file.file_id }]
      if (text(file.file_data))
        return [
          {
            type: 'input_file',
            file_data: file.file_data,
            filename: text(file.filename) || 'document.pdf'
          }
        ]
    }
    return []
  })
}

function partsText(content: unknown) {
  if (typeof content === 'string') return content
  return list(content)
    .map((part) => text(record(part).text))
    .filter(Boolean)
    .join('\n')
}

function responsesTool(raw: unknown): Json[] {
  const tool = record(raw)
  if (tool.type === 'function') {
    const fn = record(tool.function)
    if (!text(fn.name)) return []
    return [
      {
        type: 'function',
        name: fn.name,
        ...(fn.description !== undefined && { description: fn.description }),
        parameters: fn.parameters ?? { type: 'object', properties: {} },
        strict: fn.strict === true
      }
    ]
  }
  if (tool.type === 'custom') {
    const custom = record(tool.custom)
    if (!text(custom.name)) return []
    const format = record(custom.format)
    const grammar = record(format.grammar)
    return [
      {
        type: 'custom',
        name: custom.name,
        ...(custom.description !== undefined && { description: custom.description }),
        ...(format.type === 'grammar'
          ? { format: { type: 'grammar', syntax: grammar.syntax, definition: grammar.definition } }
          : format.type
            ? { format }
            : {})
      }
    ]
  }
  return []
}

function responsesToolChoice(raw: unknown) {
  if (typeof raw === 'string') return raw
  const choice = record(raw)
  if (choice.type === 'function') return { type: 'function', name: record(choice.function).name }
  if (choice.type === 'custom') return { type: 'custom', name: record(choice.custom).name }
  return undefined
}

function responsesFormat(raw: unknown) {
  const format = record(raw)
  if (format.type === 'json_schema') {
    const schema = record(format.json_schema)
    return {
      type: 'json_schema',
      name: text(schema.name) || 'response',
      schema: schema.schema ?? {},
      ...(schema.strict !== undefined && { strict: schema.strict }),
      ...(schema.description !== undefined && { description: schema.description })
    }
  }
  return format.type === 'json_object' || format.type === 'text' ? { type: format.type } : undefined
}

export function chatToResponses(payload: Json): Json {
  const input: unknown[] = []
  const customCalls = new Set<string>()
  for (const raw of list(payload.messages)) {
    const message = record(raw)
    const role = text(message.role)
    if (role === 'tool') {
      const callId = text(message.tool_call_id)
      input.push({
        type: customCalls.has(callId) ? 'custom_tool_call_output' : 'function_call_output',
        call_id: callId,
        output: partsText(message.content)
      })
      continue
    }
    if (!['system', 'developer', 'user', 'assistant'].includes(role)) continue
    const assistant = role === 'assistant'
    const content = contentParts(message.content, assistant)
    if (content.length)
      input.push({ type: 'message', role: role === 'system' ? 'developer' : role, content })
    if (!assistant) continue
    for (const rawCall of list(message.tool_calls)) {
      const call = record(rawCall)
      const callId = text(call.id) || `call_${randomUUID().replaceAll('-', '')}`
      if (call.type === 'custom') {
        const custom = record(call.custom)
        customCalls.add(callId)
        input.push({
          type: 'custom_tool_call',
          call_id: callId,
          name: custom.name,
          input: text(custom.input)
        })
        continue
      }
      const fn = record(call.function)
      if (!text(fn.name)) continue
      input.push({
        type: 'function_call',
        call_id: callId,
        name: fn.name,
        arguments:
          typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {})
      })
    }
  }

  const body: Json = { model: payload.model, input, stream: payload.stream === true, store: false }
  const tools = list(payload.tools).flatMap(responsesTool)
  if (tools.length) body.tools = tools
  const toolChoice = responsesToolChoice(payload.tool_choice)
  if (toolChoice !== undefined) body.tool_choice = toolChoice
  if (typeof payload.reasoning_effort === 'string')
    body.reasoning = { effort: payload.reasoning_effort, summary: 'auto' }
  const maxTokens = payload.max_completion_tokens ?? payload.max_tokens
  if (typeof maxTokens === 'number') body.max_output_tokens = maxTokens
  const format = responsesFormat(payload.response_format)
  if (format) body.text = { format }
  for (const name of [
    'temperature',
    'top_p',
    'parallel_tool_calls',
    'prompt_cache_key',
    'prompt_cache_retention',
    'safety_identifier',
    'service_tier',
    'metadata'
  ])
    if (payload[name] !== undefined) body[name] = payload[name]
  return body
}

function chatUsage(raw: unknown) {
  const usage = record(raw)
  if (!Object.keys(usage).length) return
  const prompt = Number(usage.input_tokens ?? 0)
  const completion = Number(usage.output_tokens ?? 0)
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: Number(usage.total_tokens ?? prompt + completion),
    prompt_tokens_details: {
      cached_tokens: Number(record(usage.input_tokens_details).cached_tokens ?? 0)
    },
    completion_tokens_details: {
      reasoning_tokens: Number(record(usage.output_tokens_details).reasoning_tokens ?? 0)
    }
  }
}

function finishReason(response: Json, called: boolean) {
  if (response.status === 'incomplete')
    return record(response.incomplete_details).reason === 'content_filter'
      ? 'content_filter'
      : 'length'
  return called ? 'tool_calls' : 'stop'
}

function chatToolCall(item: Json) {
  if (item.type === 'function_call')
    return {
      id: item.call_id,
      type: 'function',
      function: { name: item.name, arguments: text(item.arguments) }
    }
  if (item.type === 'custom_tool_call')
    return {
      id: item.call_id,
      type: 'custom',
      custom: { name: item.name, input: text(item.input) }
    }
  return undefined
}

export function responsesToChatCompletion(raw: unknown, model: string): Json {
  const response = record(raw)
  let content = ''
  let reasoning = ''
  const toolCalls: unknown[] = []
  for (const rawItem of list(response.output)) {
    const item = record(rawItem)
    if (item.type === 'message')
      for (const part of list(item.content))
        if (record(part).type === 'output_text') content += text(record(part).text)
    if (item.type === 'reasoning')
      reasoning += list(item.summary)
        .map((part) => text(record(part).text))
        .join('\n\n')
    const call = chatToolCall(item)
    if (call) toolCalls.push(call)
  }
  const message: Json = { role: 'assistant', content: content || null }
  if (reasoning) message.reasoning_content = reasoning
  if (toolCalls.length) message.tool_calls = toolCalls
  const usage = chatUsage(response.usage)
  return {
    id: `chatcmpl-${text(response.id) || randomUUID()}`,
    object: 'chat.completion',
    created: Number(response.created_at ?? Math.floor(Date.now() / 1000)),
    model: text(response.model) || model,
    choices: [{ index: 0, message, finish_reason: finishReason(response, toolCalls.length > 0) }],
    ...(usage && { usage })
  }
}

export function responsesToChatStream(model: string): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let id = `chatcmpl-${randomUUID()}`
  let created = Math.floor(Date.now() / 1000)
  let name = model
  let started = false
  let finished = false
  let nextTool = 0
  const calls = new Map<string, { index: number; custom: boolean; streamed: boolean }>()

  const emit = (out: TransformStreamDefaultController<Uint8Array>, data: unknown) =>
    out.enqueue(
      encoder.encode(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`)
    )
  const chunk = (
    out: TransformStreamDefaultController<Uint8Array>,
    delta: Json | null,
    finish: string | null = null,
    usage?: unknown
  ) =>
    emit(out, {
      id,
      object: 'chat.completion.chunk',
      created,
      model: name,
      choices: delta || finish ? [{ index: 0, delta: delta ?? {}, finish_reason: finish }] : [],
      ...(usage ? { usage } : {})
    })
  const start = (out: TransformStreamDefaultController<Uint8Array>) => {
    if (started) return
    started = true
    chunk(out, { role: 'assistant', content: '' })
  }
  const callDelta = (
    out: TransformStreamDefaultController<Uint8Array>,
    call: { index: number; custom: boolean },
    value: string
  ) =>
    chunk(out, {
      tool_calls: [
        call.custom
          ? { index: call.index, custom: { input: value } }
          : { index: call.index, function: { arguments: value } }
      ]
    })
  const fail = (out: TransformStreamDefaultController<Uint8Array>, raw: unknown) => {
    finished = true
    const error = record(raw)
    emit(out, {
      error: {
        message: text(error.message) || 'The provider ended the response with an error',
        type: text(error.type) || 'api_error',
        code: error.code ?? null
      }
    })
  }

  const handle = (out: TransformStreamDefaultController<Uint8Array>, data: string) => {
    if (finished) return
    let event: Json
    try {
      event = record(JSON.parse(data))
    } catch {
      return
    }
    const item = record(event.item)
    switch (event.type) {
      case 'response.created': {
        const response = record(event.response)
        if (text(response.id)) id = `chatcmpl-${response.id}`
        if (text(response.model)) name = text(response.model)
        if (typeof response.created_at === 'number') created = response.created_at
        start(out)
        return
      }
      case 'response.output_text.delta':
        start(out)
        if (text(event.delta)) chunk(out, { content: event.delta })
        return
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        start(out)
        if (text(event.delta)) chunk(out, { reasoning_content: event.delta })
        return
      case 'response.reasoning_summary_part.added':
        if (Number(event.summary_index) > 0) chunk(out, { reasoning_content: '\n\n' })
        return
      case 'response.output_item.added': {
        const call = chatToolCall(item)
        if (!call) return
        start(out)
        const state = {
          index: nextTool++,
          custom: item.type === 'custom_tool_call',
          streamed: false
        }
        calls.set(text(item.id) || text(item.call_id), state)
        chunk(out, {
          tool_calls: [
            state.custom
              ? {
                  index: state.index,
                  id: call.id,
                  type: 'custom',
                  custom: { name: item.name, input: '' }
                }
              : {
                  index: state.index,
                  id: call.id,
                  type: 'function',
                  function: { name: item.name, arguments: '' }
                }
          ]
        })
        return
      }
      case 'response.function_call_arguments.delta':
      case 'response.custom_tool_call_input.delta': {
        const call = calls.get(text(event.item_id))
        if (!call || !text(event.delta)) return
        call.streamed = true
        callDelta(out, call, text(event.delta))
        return
      }
      case 'response.output_item.done': {
        const call = calls.get(text(item.id) || text(item.call_id))
        const value = text(item.type === 'custom_tool_call' ? item.input : item.arguments)
        if (call && !call.streamed && value) callDelta(out, call, value)
        return
      }
      case 'response.completed':
      case 'response.incomplete': {
        const response = record(event.response)
        start(out)
        finished = true
        chunk(out, null, finishReason(response, nextTool > 0))
        const usage = chatUsage(response.usage)
        if (usage) chunk(out, null, null, usage)
        emit(out, '[DONE]')
        return
      }
      case 'response.failed':
        fail(out, record(event.response).error)
        return
      case 'error':
        fail(out, Object.keys(record(event.error)).length ? event.error : event)
        return
    }
  }

  const drain = (out: TransformStreamDefaultController<Uint8Array>, final: boolean) => {
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = final ? '' : (events.pop() ?? '')
    for (const block of events) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (data && data !== '[DONE]') handle(out, data)
    }
  }

  return new TransformStream({
    transform(part, out) {
      buffer += decoder.decode(part, { stream: true })
      drain(out, false)
    },
    flush(out) {
      buffer += decoder.decode()
      drain(out, true)
      if (!finished)
        fail(out, { message: 'The provider stream ended before the response completed' })
    }
  })
}
