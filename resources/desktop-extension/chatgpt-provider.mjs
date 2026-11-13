import { createAssistantMessageEventStream, normalizeContext } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'

// The bundled Pi executable resolves this entry from inside the binary.
let nativeProvider
function openaiProvider() {
  nativeProvider ??= builtinProviders().find((provider) => provider.id === 'openai')
  if (!nativeProvider) throw new Error('OpenAI provider is unavailable')
  return nativeProvider
}

const prefix = 'chatgpt-account-'
const validId = /^chatgpt-account-[0-9a-f-]{36}$/

/** The Pi Responses transport sees the native OpenAI model and the transcript keeps the account ID. */
export function createChatGptProvider(account, resolve) {
  const native = openaiProvider()
  const allowed = new Map(
    native
      .getModels()
      .filter((model) =>
        account.models.some(
          (entry) =>
            entry.verified && !entry.disabled && !entry.unsupported && entry.id === model.id
        )
      )
      .map((model) => [model.id, model])
  )
  const models = [...allowed.values()].map((model) => ({ ...model, provider: account.id }))
  const stream = (mode, model, context, options = {}) => {
    const output = createAssistantMessageEventStream()
    void (async () => {
      try {
        options.signal?.throwIfAborted()
        const canonical = allowed.get(model.id)
        if (!canonical) throw new Error('ChatGPT model is unavailable')
        const apiKey = await resolve(account.id, canonical.id)
        options.signal?.throwIfAborted()
        // Only Pi's built-in OpenAI endpoint receives the OAuth credential.
        const {
          headers: _headers,
          env: _env,
          fetch: _fetch,
          onPayload: _onPayload,
          onResponse: _onResponse,
          onProviderStreamEvent: _onProviderStreamEvent,
          ...request
        } = options
        const transcript = normalizeContext({
          messages: context.messages.map((message) => {
            if (message.role !== 'assistant') return message
            if (message.provider === account.id) return { ...message, provider: native.id }
            if (message.provider === native.id) return { ...message, provider: account.id }
            return message
          })
        })
        for await (const event of native[mode](canonical, transcript, {
          ...request,
          apiKey,
          fetch: (input, init) => fetch(input, { ...init, redirect: 'error' })
        })) {
          const message = event.partial ?? event.message ?? event.error
          if (message) {
            message.provider = account.id
            if (typeof message.errorMessage === 'string')
              message.errorMessage = message.errorMessage.replaceAll(apiKey, '[redacted]')
          }
          output.push(event)
        }
        output.end()
      } catch {
        const reason = options.signal?.aborted ? 'aborted' : 'error'
        output.push({
          type: 'error',
          reason,
          error: {
            role: 'assistant',
            content: [],
            api: 'openai-responses',
            provider: account.id,
            model: model.id,
            timestamp: Date.now(),
            stopReason: reason,
            errorMessage:
              reason === 'aborted'
                ? 'Request was aborted'
                : 'ChatGPT authorization is unavailable. Reconnect your account.',
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
            }
          }
        })
        output.end()
      }
    })()
    return output
  }
  return {
    id: account.id,
    name: `ChatGPT · ${account.label}`,
    baseUrl: native.baseUrl,
    // Pi's availability check needs a configured provider. The actual grant is
    // resolved for the verified model immediately before the native request.
    auth: {
      apiKey: {
        name: 'ChatGPT',
        async check() {
          return { source: 'ChatGPT', type: 'api_key' }
        },
        async resolve() {
          return { auth: { apiKey: 'pi-harness-chatgpt' } }
        }
      }
    },
    getModels: () => models,
    getAllModels: () => models,
    stream: (...args) => stream('stream', ...args),
    streamSimple: (...args) => stream('streamSimple', ...args)
  }
}

export function chatGptProviderSync(register, unregister, list, resolve) {
  let active = new Map()
  let pending = Promise.resolve()
  return () => {
    pending = pending
      .catch(() => {})
      .then(async () => {
        const next = new Map()
        for (const account of await list()) {
          if (!validId.test(account.id)) continue
          const verified = account.models.filter(
            (model) => model.verified && !model.disabled && !model.unsupported
          )
          if (!verified.length) continue
          const stamp = JSON.stringify(verified.map((model) => model.id))
          if (active.get(account.id) !== stamp) register(createChatGptProvider(account, resolve))
          next.set(account.id, stamp)
        }
        for (const id of active.keys()) {
          if (!next.has(id) && id.startsWith(prefix)) unregister(id)
        }
        active = next
      })
    return pending
  }
}
