// Public endpoint policy shared by Main and the native Pi provider extension.
export const ID = 'opencode-free'
export const BASE = 'https://opencode.ai/inference/openai/v1'
export const GO_BASE = 'https://opencode.ai/inference/go/openai/v1'
export const GO_DIRECTORY = 'https://opencode.ai/inference/go/v1/models'
export const GO_DOCS = 'https://opencode.ai/v2/docs/console/go/'
export function serviceBase(service) {
  if (service === undefined || service === 'zen') return BASE
  if (service === 'go') return GO_BASE
  throw new Error('UNTRUSTED_ENDPOINT')
}
export const DIRECTORY = 'https://opencode.ai/inference/v1/models'
export const CONFIG = 'https://opencode.ai/console/api/v2/config'
export const DOCS = 'https://opencode.ai/v2/docs/console/models/'
export const candidates = [
  'big-pickle',
  'deepseek-v4.1-flash-free',
  'mimo-v2.6-flash-free',
  'mimo-v2.5-free',
  'nemotron-3-ultra-free',
  'nemotron-3.5-lightning-free',
  'exo-free'
]
const clean = (text) =>
  text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim()
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)

export function parseCatalog(directory, html, known = [], service) {
  const base = serviceBase(service)
  if (!directory || !Array.isArray(directory.data) || directory.data.length > 2000)
    throw new Error('INVALID_CATALOG')
  const names = new Map(),
    prices = new Map(),
    costs = new Map(),
    apis = new Map()
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => clean(cell[1]))
    )
    if (rows[0]?.[1] === 'Model ID')
      for (const row of rows.slice(1))
        if (validId(row[1])) {
          names.set(row[1], row[0])
          apis.set(row[1], row[2] === `${base}/chat/completions` ? 'openai-completions' : null)
        }
    if (rows[0]?.[1] === 'Input' && rows[0]?.[2] === 'Output') {
      for (const row of rows.slice(1)) {
        if (row.length < 3) continue
        // Go appends a monthly allowance column; it is not a token price.
        const pricing = row.slice(
          1,
          rows[0].findIndex((cell) => /Monthly limit/i.test(cell)) > 0
            ? rows[0].findIndex((cell) => /Monthly limit/i.test(cell))
            : undefined
        )
        const value =
          pricing.every((cell) => cell === 'Free' || cell === '-') &&
          row[1] === 'Free' &&
          row[2] === 'Free'
            ? 'free'
            : pricing.some((cell) => /\$\d/.test(cell))
              ? 'paid'
              : 'unknown'
        const numeric = pricing.map((cell) =>
          cell === 'Free' || cell === '-'
            ? 0
            : /^\$\d+(?:\.\d+)?$/.test(cell)
              ? Number(cell.slice(1))
              : null
        )
        if (numeric.every((n) => n !== null))
          costs.set(row[0], {
            input: numeric[0],
            output: numeric[1],
            cacheRead: numeric[2] ?? 0,
            cacheWrite: numeric[3] ?? 0
          })
        if (prices.has(row[0]) && prices.get(row[0]) !== value) prices.set(row[0], 'unknown')
        else prices.set(row[0], value)
      }
    }
  }
  if (!names.size || !prices.size) throw new Error('INVALID_PRICING')
  const ids = new Set()
  for (const item of directory.data) {
    if (!validId(item.id) || ids.has(item.id)) throw new Error('INVALID_CATALOG')
    ids.add(item.id)
  }
  return [
    ...new Set([...ids, ...known.map((m) => m.id), ...(service === 'go' ? [] : candidates)])
  ].map((id) => ({
    id,
    ...(service === 'go' ? { service: 'go' } : {}),
    name: names.get(id) ?? id,
    price: prices.get(names.get(id)) ?? 'unknown',
    available: ids.has(id),
    api: apis.get(id) ?? null,
    cost: costs.get(names.get(id)) ?? null
  }))
}

export function errorCode(status, body = '') {
  // Only inspect known upstream type markers; never return response messages or keys.
  if (/FreeTierError/.test(body)) return 'FREE_TIER_RESTRICTED'
  if (/RegionRestricted|region_restricted|unsupported_country/i.test(body))
    return 'REGION_RESTRICTED'
  if (status === 402 || /InsufficientBalance|insufficient_balance/i.test(body))
    return 'INSUFFICIENT_BALANCE'
  if (status === 401) return 'INVALID_API_KEY'
  if (status === 403) return 'INSUFFICIENT_PERMISSION'
  if (status === 410) return 'MODEL_DEPRECATED'
  if (status === 404) return 'MODEL_UNAVAILABLE'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'SERVICE_UNAVAILABLE'
  return 'INVALID_RESPONSE'
}

export async function boundedText(response, maximum = 4 * 1024 * 1024) {
  if (!response.body) throw new Error('EMPTY_RESPONSE')
  const reader = response.body.getReader(),
    chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maximum) throw new Error('RESPONSE_TOO_LARGE')
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export async function request(url, init = {}, fetcher = fetch) {
  if (
    ![
      DIRECTORY,
      DOCS,
      GO_DIRECTORY,
      GO_DOCS,
      CONFIG,
      `${BASE}/chat/completions`,
      `${GO_BASE}/chat/completions`
    ].includes(url)
  )
    throw new Error('UNTRUSTED_ENDPOINT')
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)])
    : AbortSignal.timeout(60000)
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    const headers = new Headers(init.headers)
    headers.set('user-agent', 'Pi-Harness')
    const response = await fetcher(url, {
      ...init,
      headers: Object.fromEntries(headers),
      signal,
      redirect: 'error'
    })
    if (response.status !== 429 || attempt >= 2) return response
    const retry = response.headers.get('retry-after')
    const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) : null
    const delay = retry
      ? seconds !== null
        ? seconds * 1000
        : Date.parse(retry) - Date.now()
      : 500 * 2 ** attempt
    if (!Number.isFinite(delay) || delay > 10000) return response
    await response.body?.cancel()
    await new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer)
        reject(signal.reason)
      }
      const timer = setTimeout(
        () => {
          signal.removeEventListener('abort', abort)
          resolve()
        },
        Math.max(0, delay)
      )
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }
}

export async function fetchCatalog(known = [], signal, fetcher = fetch, service) {
  const responses = await Promise.all(
    (service === 'go' ? [GO_DIRECTORY, GO_DOCS] : [DIRECTORY, DOCS]).map((url) =>
      request(url, { signal }, fetcher)
    )
  )
  const bodies = await Promise.all(
    responses.map(async (response) => {
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(errorCode(response.status))
      }
      return boundedText(response)
    })
  )
  return parseCatalog(JSON.parse(bodies[0]), bodies[1], known, service)
}

/** Current protocol and prices must match the explicitly selected service and model. */
export async function assertAllowed(id, state, signal, fetcher) {
  if (state.authMode !== 'inference') throw new Error('NOT_VERIFIED')
  if (!state.authorizedModels?.includes(id)) throw new Error('INSUFFICIENT_PERMISSION')
  const previous = state.models.find((m) => m.id === id)
  serviceBase(previous?.service)
  const catalog = await fetchCatalog([], signal, fetcher, previous?.service)
  const model = catalog.find((m) => m.id === id)
  if (!model?.available) throw new Error('MODEL_UNAVAILABLE')
  if (model.api !== 'openai-completions') throw new Error('PROTOCOL_NOT_VERIFIED')
  if (model.price === 'unknown' || !model.cost) throw new Error('PRICE_UNKNOWN')
  if (model.price === 'paid' && !state.allowedPaidModels?.includes(id))
    throw new Error('PAID_AUTHORIZATION_REQUIRED')
  if (model.price === 'paid' && JSON.stringify(previous?.cost) !== JSON.stringify(model.cost))
    throw new Error('PRICE_CHANGED')
  return model
}

export async function authorizedAccess(key, signal, fetcher) {
  if (!key) throw new Error('NOT_CONFIGURED')
  const response = await request(
    CONFIG,
    { signal, headers: { authorization: `Bearer ${key}` } },
    fetcher
  )
  const body = await boundedText(response)
  if (!response.ok) {
    const error = new Error(errorCode(response.status, body))
    error.httpStatus = response.status
    throw error
  }
  let config
  try {
    config = JSON.parse(body)
    if (!config.providers || typeof config.providers !== 'object')
      throw new Error('INVALID_RESPONSE')
  } catch {
    const error = new Error('INVALID_RESPONSE')
    error.httpStatus = response.status
    throw error
  }
  // Built-in provider model maps are sparse overrides, not permission whitelists.
  // Inherit only an exact built-in ID's public catalog; custom gateways remain explicit.
  const routes = Object.create(null)
  const directories = new Map()
  const defaults = async (service) => {
    if (!directories.has(service)) {
      const response = await request(
        service === 'go' ? GO_DIRECTORY : DIRECTORY,
        { signal },
        fetcher
      )
      const text = await boundedText(response)
      if (!response.ok) throw new Error(errorCode(response.status, text))
      const directory = JSON.parse(text)
      if (
        !Array.isArray(directory?.data) ||
        directory.data.length > 2000 ||
        directory.data.some((model) => !validId(model?.id))
      )
        throw new Error('INVALID_CATALOG')
      directories.set(
        service,
        directory.data.map((model) => model.id)
      )
    }
    return directories.get(service)
  }
  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (!provider || provider.disabled === true || provider.enabled === false) continue
    const builtin =
      providerId === 'opencode' ? 'zen' : providerId === 'opencode-go' ? 'go' : undefined
    const base = provider.settings?.baseURL
    // A malicious/unsupported override must not fall back to a trusted built-in URL.
    if (base !== undefined && ![BASE, GO_BASE].includes(base)) continue
    if (!builtin && base === undefined) continue
    const service = base === GO_BASE ? 'go' : base === BASE ? 'zen' : builtin
    if (builtin && service !== builtin) continue
    const overrides = provider.models ?? {}
    if (typeof overrides !== 'object' || Array.isArray(overrides)) continue
    const ids = builtin ? await defaults(service) : Object.keys(overrides)
    for (const id of ids) {
      if (!validId(id)) continue
      const model = overrides[id]
      if (model?.disabled === true || model?.enabled === false) continue
      if (model?.modelID && model.modelID !== id) continue
      if (model?.settings?.baseURL !== undefined && model.settings.baseURL !== serviceBase(service))
        continue
      // Go denial never retries through paid Zen. Both still require real inference proof.
      if (routes[id] !== 'go') routes[id] = service
    }
  }
  return { modelIds: Object.keys(routes), routes }
}
export async function authorizedModels(key, signal, fetcher) {
  return (await authorizedAccess(key, signal, fetcher)).modelIds
}

// Only an explicit code allowlist may cross a process or UI boundary.
const diagnosticCodes = new Set([
  'EMPTY_RESPONSE',
  'FRAME_TOO_LARGE',
  'FREE_TIER_RESTRICTED',
  'INSUFFICIENT_BALANCE',
  'INSUFFICIENT_PERMISSION',
  'INVALID_API_KEY',
  'INVALID_CATALOG',
  'INVALID_FINISH_REASON',
  'INVALID_PAYLOAD',
  'INVALID_PRICING',
  'INVALID_RESPONSE',
  'INVALID_STREAM',
  'INVALID_TOOL_CALL',
  'INVALID_USAGE',
  'MODEL_DEPRECATED',
  'MODEL_METADATA_UNKNOWN',
  'MODEL_NOT_VERIFIED',
  'MODEL_UNAVAILABLE',
  'NETWORK_ERROR',
  'NOT_CONFIGURED',
  'NOT_VERIFIED',
  'PAID_AUTHORIZATION_REQUIRED',
  'PAYLOAD_OVERRIDE_UNSUPPORTED',
  'PI_MODEL_REGISTRATION_FAILED',
  'PI_TOOL_ROUNDTRIP_NOT_VERIFIED',
  'PRICE_CHANGED',
  'PRICE_UNKNOWN',
  'PROBE_TOOL_LIMIT',
  'PROTOCOL_NOT_VERIFIED',
  'PROVIDER_DISABLED',
  'RATE_LIMITED',
  'REGION_RESTRICTED',
  'REQUEST_CANCELLED',
  'REQUEST_TIMEOUT',
  'RESPONSE_TOO_LARGE',
  'SERVICE_UNAVAILABLE',
  'STREAM_ERROR',
  'TRUNCATED_STREAM',
  'UNSUPPORTED_INPUT',
  'UNSUPPORTED_MESSAGE',
  'UNSUPPORTED_TOOL_RESULT',
  'UNTRUSTED_ENDPOINT',
  'USAGE_NOT_REPORTED'
])
export function safeErrorCode(error) {
  if (error?.name === 'TimeoutError') return 'REQUEST_TIMEOUT'
  return diagnosticCodes.has(error?.message) ? error.message : 'NETWORK_ERROR'
}
