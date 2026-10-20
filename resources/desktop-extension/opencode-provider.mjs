import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  parseStreamingJson
} from '@earendil-works/pi-ai'
import {
  BASE,
  serviceBase,
  ID,
  request,
  boundedText,
  assertAllowed,
  errorCode,
  safeErrorCode
} from './opencode-catalog.mjs'

export { readState, runtimeModels } from './opencode-state.mjs'
import { readState, runtimeModels } from './opencode-state.mjs'

// Only the wire adapter is custom. Transcript state, tools, sessions and the agent loop remain Pi's.
export function messagesFor(model, context) {
  const messages = []
  let toolImages = []
  const flushImages = () => {
    if (toolImages.length) messages.push({ role: 'user', content: toolImages })
    toolImages = []
  }
  const system = getCurrentSystemPrompt(context.messages)
  if (system) messages.push({ role: 'system', content: system })
  for (const msg of context.messages) {
    if (msg.role !== 'toolResult') flushImages()
    if (msg.role === 'system') continue
    if (msg.role === 'user') {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content.map((part) => {
              if (part.type === 'text') return { type: 'text', text: part.text }
              if (part.type !== 'image' || !model.input.includes('image'))
                throw new Error('UNSUPPORTED_INPUT')
              return {
                type: 'image_url',
                image_url: { url: `data:${part.mimeType};base64,${part.data}` }
              }
            })
      messages.push({ role: 'user', content })
    } else if (msg.role === 'assistant') {
      if (msg.stopReason === 'error' || msg.stopReason === 'aborted') continue
      const calls = msg.content
        .filter((p) => p.type === 'toolCall')
        .map((p) => ({
          id: p.id,
          type: 'function',
          function: { name: p.name, arguments: JSON.stringify(p.arguments) }
        }))
      const thinking = msg.content
        .filter((p) => p.type === 'thinking')
        .map((p) => p.thinking)
        .join('')
      messages.push({
        role: 'assistant',
        content:
          msg.content
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('') || null,
        ...(thinking ? { reasoning_content: thinking } : {}),
        ...(calls.length ? { tool_calls: calls } : {})
      })
    } else if (msg.role === 'toolResult') {
      for (const part of msg.content.filter((p) => p.type !== 'text')) {
        if (part.type !== 'image' || !model.input.includes('image'))
          throw new Error('UNSUPPORTED_TOOL_RESULT')
        toolImages.push(
          { type: 'text', text: `Image from tool ${msg.toolName ?? msg.toolCallId}:` },
          { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
        )
      }
      messages.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content:
          msg.content
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('\n') || '[Image attached]'
      })
    } else throw new Error('UNSUPPORTED_MESSAGE')
  }
  flushImages()
  return messages
}

/** Stateful SSE decoding, bounded across chunks; incomplete responses never become successful turns. */
export async function* sse(response) {
  if (!response.headers.get('content-type')?.includes('text/event-stream'))
    throw new Error('INVALID_STREAM')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('EMPTY_RESPONSE')
  const decoder = new TextDecoder()
  let buffer = '',
    bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > 16 * 1024 * 1024) throw new Error('RESPONSE_TOO_LARGE')
      buffer += decoder.decode(value, { stream: true })
      let match
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data) continue
        if (data === '[DONE]') return
        yield JSON.parse(data)
      }
      if (buffer.length > 1024 * 1024) throw new Error('FRAME_TOO_LARGE')
    }
    throw new Error('TRUNCATED_STREAM')
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export function createOpenCodeProvider({
  state: loadState = readState,
  fetcher = fetch,
  probe = false,
  resolveKey = async () => undefined
} = {}) {
  let snapshot = { enabled: false, models: [] }
  const stream = (model, context, options = {}) => {
    const events = createAssistantMessageEventStream()
    const output = {
      role: 'assistant',
      content: [],
      api: 'openai-completions',
      provider: ID,
      model: model.id,
      timestamp: Date.now(),
      stopReason: 'pending',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      }
    }
    void (async () => {
      const signal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(60000)
      try {
        const state = await loadState()
        if (!probe && !runtimeModels(state).some((m) => m.id === model.id))
          throw new Error('MODEL_NOT_VERIFIED')
        if (state.authMode !== 'inference') throw new Error('NOT_VERIFIED')
        // Resolve on every turn; deleting/replacing a key revokes existing sessions too.
        const key = await resolveKey()
        if (!key) throw new Error('NOT_CONFIGURED')
        const current = await assertAllowed(model.id, state, signal, fetcher)
        if (current.service === 'go' && !options.sessionId) throw new Error('NOT_VERIFIED')
        const tools = getCurrentTools(context.messages).map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters }
        }))
        const payload = {
          model: model.id,
          messages: messagesFor(model, context),
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: Math.min(options.maxTokens ?? 4096, model.maxTokens),
          ...(tools.length ? { tools, tool_choice: 'auto' } : {})
        }
        // Plugins may inspect payloads, but cannot replace this provider's model or transport policy.
        const originalPayload = JSON.stringify(payload)
        const replacement = await options.onPayload?.(payload, model)
        if (
          (replacement !== undefined && JSON.stringify(replacement) !== originalPayload) ||
          JSON.stringify(payload) !== originalPayload
        )
          throw new Error('PAYLOAD_OVERRIDE_UNSUPPORTED')
        if (payload.model !== model.id || payload.stream !== true)
          throw new Error('INVALID_PAYLOAD')
        const response = await request(
          `${serviceBase(current.service)}/chat/completions`,
          {
            method: 'POST',
            signal,
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${key}`,
              ...(options.sessionId ? { 'x-opencode-session': options.sessionId } : {})
            },
            body: JSON.stringify(payload)
          },
          fetcher
        )
        await options.onResponse?.(
          { status: response.status, headers: Object.fromEntries(response.headers) },
          model
        )
        if (!response.ok)
          throw new Error(errorCode(response.status, await boundedText(response, 65536)))
        events.push({ type: 'start', partial: output })
        let finish,
          usage = false
        const slots = new Map(),
          argumentsText = new Map()
        const append = (kind, delta, slot) => {
          if (!delta) return
          if (typeof delta !== 'string') throw new Error('INVALID_STREAM')
          let index = slots.get(slot)
          if (index === undefined) {
            index = output.content.length
            slots.set(slot, index)
            output.content.push(
              kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' }
            )
            events.push({ type: `${kind}_start`, contentIndex: index, partial: output })
          }
          const block = output.content[index]
          block[kind === 'text' ? 'text' : 'thinking'] += delta
          events.push({ type: `${kind}_delta`, contentIndex: index, delta, partial: output })
        }
        for await (const chunk of sse(response)) {
          if (chunk.error) throw new Error('STREAM_ERROR')
          if (chunk.usage) {
            const u = chunk.usage
            if (
              ![u.prompt_tokens, u.completion_tokens, u.total_tokens].every(
                (n) => Number.isSafeInteger(n) && n >= 0
              )
            )
              throw new Error('INVALID_USAGE')
            const cached = u.prompt_tokens_details?.cached_tokens ?? 0
            if (!Number.isSafeInteger(cached) || cached < 0 || cached > u.prompt_tokens)
              throw new Error('INVALID_USAGE')
            output.usage = {
              ...output.usage,
              input: u.prompt_tokens - cached,
              cacheRead: cached,
              output: u.completion_tokens,
              totalTokens: u.total_tokens
            }
            const cost = current.cost
            output.usage.cost = {
              input: (output.usage.input * cost.input) / 1e6,
              output: (output.usage.output * cost.output) / 1e6,
              cacheRead: (output.usage.cacheRead * cost.cacheRead) / 1e6,
              cacheWrite: 0,
              total: 0
            }
            output.usage.cost.total =
              output.usage.cost.input + output.usage.cost.output + output.usage.cost.cacheRead
            usage = true
          }
          const choice = chunk.choices?.[0]
          if (!choice) continue
          if (choice.index !== undefined && choice.index !== 0) throw new Error('INVALID_STREAM')
          const delta = choice.delta ?? {}
          append('text', delta.content, 'text')
          append('thinking', delta.reasoning_content ?? delta.reasoning, 'thinking')
          for (const call of delta.tool_calls ?? []) {
            if (!Number.isSafeInteger(call.index) || call.index < 0 || call.index > 127)
              throw new Error('INVALID_TOOL_CALL')
            const slot = `tool:${call.index}`
            let index = slots.get(slot)
            if (index === undefined) {
              index = output.content.length
              slots.set(slot, index)
              output.content.push({ type: 'toolCall', id: '', name: '', arguments: {} })
              argumentsText.set(index, '')
              events.push({ type: 'toolcall_start', contentIndex: index, partial: output })
            }
            const block = output.content[index]
            if (call.id) block.id += call.id
            if (call.function?.name) block.name += call.function.name
            const text = call.function?.arguments ?? ''
            if (typeof text !== 'string') throw new Error('INVALID_TOOL_CALL')
            argumentsText.set(index, argumentsText.get(index) + text)
            block.arguments = parseStreamingJson(argumentsText.get(index))
            events.push({
              type: 'toolcall_delta',
              contentIndex: index,
              delta: text,
              partial: output
            })
          }
          if (choice.finish_reason) finish = choice.finish_reason
        }
        if (!['stop', 'length', 'tool_calls'].includes(finish))
          throw new Error('INVALID_FINISH_REASON')
        // Pi's usage contract is numeric. Missing upstream usage must never be silently counted as zero.
        if (!usage) throw new Error('USAGE_NOT_REPORTED')
        const ids = new Set()
        for (let i = 0; i < output.content.length; i++) {
          const block = output.content[i]
          if (block.type === 'toolCall') {
            const args = JSON.parse(argumentsText.get(i))
            if (
              !args ||
              typeof args !== 'object' ||
              Array.isArray(args) ||
              !block.id ||
              ids.has(block.id) ||
              !tools.some((t) => t.function.name === block.name)
            )
              throw new Error('INVALID_TOOL_CALL')
            ids.add(block.id)
            block.arguments = args
            events.push({ type: 'toolcall_end', contentIndex: i, toolCall: block, partial: output })
          } else
            events.push({
              type: `${block.type}_end`,
              contentIndex: i,
              content: block.text ?? block.thinking,
              partial: output
            })
        }
        if (ids.size > 0 !== (finish === 'tool_calls')) throw new Error('INVALID_TOOL_CALL')
        output.stopReason =
          finish === 'tool_calls' ? 'toolUse' : finish === 'length' ? 'length' : 'stop'
        events.push({ type: 'done', reason: output.stopReason, message: output })
      } catch (error) {
        output.stopReason = signal.aborted ? 'aborted' : 'error'
        // Only our diagnostic codes cross the boundary; upstream bodies and keys never do.
        output.errorMessage = signal.aborted
          ? 'REQUEST_CANCELLED_OR_TIMED_OUT'
          : safeErrorCode(error)
        events.push({ type: 'error', reason: output.stopReason, error: output })
      } finally {
        events.end()
      }
    })()
    return events
  }
  return {
    id: ID,
    name: 'OpenCode',
    baseUrl: BASE,
    auth: {
      apiKey: {
        name: 'OpenCode Console Service Account Key',
        resolve: async () => {
          const state = await loadState()
          if (state.authMode !== 'inference' || !state.enabled || !state.hasCredential)
            return undefined
          const key = await resolveKey()
          return key ? { auth: { apiKey: key }, source: 'inference' } : undefined
        }
      }
    },
    getModels: () => runtimeModels(snapshot),
    refreshModels: async () => {
      snapshot = await loadState()
    },
    stream,
    streamSimple: stream
  }
}

export async function registerOpenCode(pi, options = {}) {
  const provider = createOpenCodeProvider(options)
  await provider.refreshModels()
  pi.registerProvider(provider)
}
