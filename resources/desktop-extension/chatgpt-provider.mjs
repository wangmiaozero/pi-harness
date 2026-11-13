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
export function createChatGptProvider(account, fetchResponses) {
  const native = openaiProvider()
  const nativeModels = new Map(native.getModels().map((model) => [model.id, model]))
  const allowed = new Map(
    account.models
      .filter((entry) => !entry.disabled && !entry.unsupported && nativeModels.has(entry.id))
      .map((entry) => {
        const model = nativeModels.get(entry.id)
        return [entry.id, { ...model, contextWindow: entry.contextWindow ?? model.contextWindow }]
      })
  )
  const models = [...allowed.values()].map((model) => ({ ...model, provider: account.id }))
  const stream = (mode, model, context, options = {}) => {
    const output = createAssistantMessageEventStream()
    void (async () => {
      try {
        options.signal?.throwIfAborted()
        const canonical = allowed.get(model.id)
        if (!canonical) throw new Error('ChatGPT model is unavailable')
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
          apiKey: 'pi-harness-chatgpt',
          fetch: (input, init) => {
            if (String(input) !== 'https://api.openai.com/v1/responses')
              throw new Error('Unexpected ChatGPT request endpoint')
            return fetchResponses(account.id, canonical.id, init)
          }
        })) {
          const message = event.partial ?? event.message ?? event.error
          if (message) {
            message.provider = account.id
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
    // resolved by the desktop host immediately before the native request.
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

export function chatGptProviderSync(register, unregister, list, fetchResponses) {
  let active = new Map()
  let pending = Promise.resolve()
  return () => {
    pending = pending
      .catch(() => {})
      .then(async () => {
        const next = new Map()
        for (const account of await list()) {
          if (!validId.test(account.id)) continue
          const models = account.models.filter((model) => !model.disabled && !model.unsupported)
          if (!models.length) continue
          const stamp = JSON.stringify([
            account.label,
            ...models.map((model) => [model.id, model.contextWindow])
          ])
          if (active.get(account.id) !== stamp)
            register(createChatGptProvider(account, fetchResponses))
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
