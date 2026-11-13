import { AsyncLocalStorage } from 'node:async_hooks'
import { readBoundedJson } from './bounded-json'

const TOKEN_ENDPOINT = 'https://auth.openai.com/api/accounts/oauth/token'
const TOKEN_TIMEOUT_MS = 20_000

type Fetch = typeof globalThis.fetch

let depth = 0
let installed: Fetch | undefined
let saved: Fetch | undefined
let systemFetchImpl: Promise<Fetch | undefined> | undefined
let capturedIdToken: string | undefined
const exchange = new AsyncLocalStorage<string>()

/** The ID token from the latest OpenAI token response, if that response had one. */
export function takeCapturedIdToken(): string | undefined {
  const token = capturedIdToken
  capturedIdToken = undefined
  return token
}

export class OAuthExchangeError extends Error {
  constructor(
    readonly reason: 'rejected' | 'timeout' | 'network',
    readonly status?: number,
    readonly upstreamCode?: string
  ) {
    super(status === undefined ? `OAuth exchange: ${reason}` : `OAuth exchange: HTTP ${status}`)
  }
}

function electronFetch(): Promise<Fetch | undefined> {
  systemFetchImpl ??= import('electron')
    .then((electron) => {
      const net = (electron as { net?: { fetch?: Fetch } }).net
      const candidate = net?.fetch
      return typeof candidate === 'function' ? (candidate.bind(net) as Fetch) : undefined
    })
    .catch(() => undefined)
  return systemFetchImpl
}

function requestUrl(input: Parameters<Fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

async function fetchToken(via: Fetch, input: Parameters<Fetch>[0], init?: RequestInit) {
  const deadline = AbortSignal.timeout(TOKEN_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline
  try {
    const response = await via(input, { ...init, redirect: 'error', signal })
    if (response.ok) {
      const body = await response.clone().text().catch(() => '')
      try {
        const idToken = (JSON.parse(body) as { id_token?: unknown }).id_token
        if (typeof idToken === 'string' && idToken) capturedIdToken = idToken
      } catch {
        // A successful token response is JSON. Anything else is left for the caller.
      }
      return response
    }

    const payload = await readBoundedJson(response, 8_192).catch(() => null)
    const error = (payload as { error?: { code?: unknown } | string } | null)?.error
    const code = typeof error === 'string' ? error : error?.code
    const known = code === 'unsupported_country_region_territory' || code === 'invalid_grant'
    throw new OAuthExchangeError('rejected', response.status, known ? code : undefined)
  } catch (error) {
    if (error instanceof OAuthExchangeError || init?.signal?.aborted) throw error
    throw new OAuthExchangeError(deadline.aborted ? 'timeout' : 'network')
  }
}

/** Pi's OAuth interface uses global fetch. Only intercept the scoped token request. */
export async function withSystemProxyFetch<T>(
  run: () => Promise<T>,
  endpoint = TOKEN_ENDPOINT
): Promise<T> {
  const via = await electronFetch()
  if (depth === 0) {
    const current = globalThis.fetch
    saved = current
    installed = (input, init) =>
      exchange.getStore() === requestUrl(input)
        ? fetchToken(via ?? current, input, init)
        : current(input, init)
    globalThis.fetch = installed
  }
  depth += 1
  try {
    return await exchange.run(endpoint, run)
  } finally {
    depth -= 1
    if (depth === 0 && saved) {
      if (globalThis.fetch === installed) globalThis.fetch = saved
      saved = undefined
      installed = undefined
    }
  }
}

export async function systemFetch(
  input: Parameters<Fetch>[0],
  init?: Parameters<Fetch>[1]
): Promise<Response> {
  const via = await electronFetch()
  return (via ?? globalThis.fetch)(input, init)
}
