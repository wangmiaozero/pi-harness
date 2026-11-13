import { lazyStream } from '@earendil-works/pi-ai'
import { getApiProvider } from '@earendil-works/pi-ai/compat'

function expand(value, sessionId) {
  if (typeof value === 'string') return value.replaceAll('${sessionId}', () => sessionId ?? '')
  if (Array.isArray(value)) return value.map((entry) => expand(entry, sessionId))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, expand(entry, sessionId)])
    )
  return value
}

export function applyProviderBody(payload, fields, sessionId) {
  if (!fields || !payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  return {
    ...expand(fields, sessionId),
    ...Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
  }
}

export function maskProviderPrompt(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const maskText = (text) =>
    text
      .replace(
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        '[redacted private key]'
      )
      .replace(
        /\b(sk-(?:ant-)?[A-Za-z0-9_-]{16,}|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16})\b/g,
        '[redacted key]'
      )
      .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[redacted token]')
  const mask = (value) => {
    if (typeof value === 'string') return maskText(value)
    if (Array.isArray(value)) return value.map(mask)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) =>
        [
          'url',
          'image_url',
          'inlineData',
          'data',
          'encrypted_content',
          'thoughtSignature'
        ].includes(key)
          ? [key, entry]
          : [key, mask(entry)]
      )
    )
  }
  const fields = [
    'messages',
    'input',
    'contents',
    'system',
    'systemInstruction',
    'instructions',
    'prompt'
  ]
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, fields.includes(key) ? mask(value) : value])
  )
}

export function applyProviderHeaders(headers, settings, protocol, sessionId) {
  if (!settings) return headers
  const current = new Headers(Object.entries(headers).filter(([, value]) => value != null))
  const bearer = current.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
  const apiHeader = protocol === 'google-generative-ai' ? 'x-goog-api-key' : 'x-api-key'
  const key = current.get(apiHeader) ?? bearer
  if (key && settings.authMode) {
    headers.authorization = settings.authMode === 'api-key' ? null : `Bearer ${key}`
    headers[apiHeader] = settings.authMode === 'bearer' ? null : key
    for (const name of Object.keys(headers)) {
      if ([apiHeader, 'authorization'].includes(name.toLowerCase()) && name !== name.toLowerCase())
        delete headers[name]
    }
  }
  if (settings.sendUserAgent === false) {
    for (const name of Object.keys(headers))
      if (name.toLowerCase() === 'user-agent') delete headers[name]
    headers['user-agent'] = null
  }
  for (const name of Object.keys(headers)) {
    const value = headers[name]
    if (
      typeof value === 'string' &&
      settings.requestHeaders?.some((key) => key.toLowerCase() === name.toLowerCase())
    )
      headers[name] = expand(value, sessionId)
  }
  return headers
}

export function modelLimit(limits, model) {
  return (Object.hasOwn(limits ?? {}, model) ? limits[model] : undefined) ?? limits?.['*']
}

export function installProviderSettings(pi, load, network) {
  const settingsFor = async (ctx) =>
    ctx.model ? load(ctx.model.provider, ctx.model.baseUrl) : undefined
  pi.on('before_provider_request', async (event, ctx) => {
    const settings = await settingsFor(ctx)
    const body = applyProviderBody(
      event.payload,
      settings?.extraBody,
      ctx.sessionManager.getSessionId()
    )
    return settings?.redactSecrets ? maskProviderPrompt(body) : body
  })
  pi.on('before_agent_start', async (_event, ctx) => {
    const settings = await settingsFor(ctx)
    const model = ctx.model
    const threshold = model && modelLimit(settings?.compactionThresholds, model.id)
    const usage = ctx.getContextUsage()
    if (
      !threshold ||
      !usage?.tokens ||
      usage.tokens < threshold ||
      pi.getSettings().compaction?.enabled === false
    )
      return
    await new Promise((resolve, reject) => ctx.compact({ onComplete: resolve, onError: reject }))
  })
  pi.on('before_provider_headers', async (event, ctx) => {
    applyProviderHeaders(
      event.headers,
      await settingsFor(ctx),
      ctx.model?.api,
      ctx.sessionManager.getSessionId()
    )
  })
  pi.on('after_provider_response', async (event, ctx) => {
    const names = (await settingsFor(ctx))?.responseHeaders
    if (!names?.length) return
    const headers = new Headers(event.headers)
    const values = names.flatMap((name) => {
      const value = headers.get(name)
      return value ? [`${name}: ${value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160)}`] : []
    })
    ctx.ui.setStatus('provider-response-headers', values.join(' · ') || undefined)
  })
  return async () => {
    const providers = await network.list()
    for (const { key, protocol, baseUrl, apiKey } of providers) {
      const api = getApiProvider(protocol)
      if (!api) continue
      pi.registerProvider(key, {
        api: protocol,
        ...(apiKey ? { baseUrl, apiKey } : {}),
        streamSimple(model, context, options = {}) {
          return lazyStream(
            model,
            async () => {
              const settings = await load(model.provider, model.baseUrl)
              const headers = { ...options.headers }
              const apiHeader =
                model.api === 'google-generative-ai' ? 'x-goog-api-key' : 'x-api-key'
              if (
                settings?.authMode &&
                options.apiKey &&
                !Object.keys(headers).some((name) =>
                  ['authorization', apiHeader].includes(name.toLowerCase())
                )
              )
                headers[apiHeader] = options.apiKey
              const invoke = (fetch, baseUrl) =>
                api.streamSimple(baseUrl ? { ...model, baseUrl } : model, context, {
                  ...options,
                  ...(fetch ? { fetch } : {}),
                  headers: applyProviderHeaders(headers, settings, model.api, options.sessionId)
                })
              if (!settings) return invoke()
              if (model.api === 'google-generative-ai' && settings.proxy && network.googleBaseUrl) {
                const target = await network.googleBaseUrl(model.provider, model.baseUrl)
                return invoke(undefined, target)
              }
              if (
                model.api !== 'google-generative-ai' &&
                (settings.proxy ||
                  settings.concurrency ||
                  settings.requestsPerMinute ||
                  settings.responsesWebSocket)
              )
                return invoke((input, init) =>
                  network.fetch(model.provider, model.baseUrl, input, init)
                )
              const release = await network.acquire(model.provider, model.baseUrl, options.signal)
              return (async function* () {
                try {
                  yield* invoke()
                } finally {
                  await release?.()
                }
              })()
            },
            undefined,
            options.signal
          )
        }
      })
    }
  }
}
