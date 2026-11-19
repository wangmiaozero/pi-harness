import {
  parseProviderProxyUrl,
  type ProviderAdvancedSettings
} from '@shared/providers/advanced-settings'
import type {
  AutomaticProxySource,
  ProviderNetworkDiagnostic
} from '@shared/providers/connection-diagnostics'
import { fetchResponsesWebSocket } from './responses-websocket'
import {
  bypassesProxy,
  isLocalProxyTarget,
  loginProxyEnvironment,
  proxyForTarget
} from './provider-proxy-environment'

type Proxy = ProviderAdvancedSettings['proxy']
type ElectronSession = import('electron').Session
const sessions = new Map<string, Promise<ElectronSession>>()
let electronSessions: Promise<typeof import('electron').session | undefined> | undefined
function getElectronSessions() {
  return (electronSessions ??= import('electron').then((electron) =>
    'session' in electron ? electron.session : undefined
  ))
}
const schemes: Readonly<Record<string, string>> = {
  PROXY: 'http',
  HTTPS: 'https',
  SOCKS: 'socks4',
  SOCKS4: 'socks4',
  SOCKS5: 'socks5'
}

export class ProviderTransportError extends Error {
  constructor(
    readonly kind: 'proxy_error' | 'protocol_error',
    cause?: unknown
  ) {
    super(kind, { cause })
  }
}

function proxyUrl(value: string) {
  const url = parseProviderProxyUrl(value)
  if (!url) throw new ProviderTransportError('proxy_error')
  return `${url.protocol}//${url.host}`
}

interface ProviderRoute {
  address: string
  source?: AutomaticProxySource
}

async function systemRoute(target: URL): Promise<string | undefined> {
  try {
    const session = await getElectronSessions()
    if (!session?.defaultSession) return undefined
    // The first route is the one this request will use, even if Chromium lists fallbacks.
    const route = (await session.defaultSession.resolveProxy(target.href)).split(';')[0]?.trim()
    if (route === 'DIRECT') return 'direct'
    const match = /^(PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5) ([a-z\d.[\]:_-]+)$/i.exec(route ?? '')
    if (!match) throw new ProviderTransportError('proxy_error')
    return proxyUrl(`${schemes[match[1].toUpperCase()]}://${match[2]}`)
  } catch (error) {
    throw new ProviderTransportError('proxy_error', error)
  }
}

function environmentRoute(value: string) {
  const address = value.includes('://') ? value : `http://${value}`
  return proxyUrl(address.replace(/^socks5h?:\/\//i, 'socks5://'))
}

async function resolveProxy(target: URL, proxy: Proxy): Promise<ProviderRoute | undefined> {
  if (proxy?.mode === 'direct') return { address: 'direct' }
  if (proxy?.mode === 'custom') return { address: proxyUrl(proxy.url) }
  if (proxy?.mode === 'system') {
    const address = await systemRoute(target)
    if (!address) throw new ProviderTransportError('proxy_error')
    return { address }
  }

  // Standalone Node callers keep their native fetch behavior. Desktop requests pin
  // their route in an Electron session, without modifying Node's global dispatcher.
  if (!(await getElectronSessions())?.defaultSession) return undefined
  if (isLocalProxyTarget(target) || bypassesProxy(target, process.env)) return { address: 'direct' }
  const environment = proxyForTarget(target, process.env)
  if (environment) return { address: environmentRoute(environment), source: 'environment' }
  const system = await systemRoute(target)
  if (system && system !== 'direct') return { address: system, source: 'system' }
  const login = await loginProxyEnvironment()
  if (bypassesProxy(target, login)) return { address: 'direct' }
  const shell = proxyForTarget(target, login)
  if (shell) return { address: environmentRoute(shell), source: 'login_shell' }
  return { address: 'direct' }
}

function isolatedSession(route: string) {
  let pending = sessions.get(route)
  if (!pending) {
    const name = `provider-network-${crypto.randomUUID()}`
    pending = getElectronSessions().then(async (session) => {
      if (!session) throw new ProviderTransportError('proxy_error')
      const partition = session.fromPartition(name, { cache: false })
      await partition.setProxy(
        route === 'direct'
          ? { mode: 'direct' }
          : { mode: 'fixed_servers', proxyRules: route, proxyBypassRules: '<-loopback>' }
      )
      return partition
    })
    sessions.set(route, pending)
    void pending.catch(() => sessions.delete(route))
  }
  return pending
}

function abortable<T>(pending: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return pending
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function fetchProvider(
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  proxy?: Proxy,
  diagnostic?: ProviderNetworkDiagnostic,
  websocketPayload?: Record<string, unknown>
): Promise<Response> {
  init.signal?.throwIfAborted()
  const schemeTarget = new URL(
    typeof input === 'string' || input instanceof URL ? input : input.url
  )
  if (websocketPayload) schemeTarget.protocol = schemeTarget.protocol === 'https:' ? 'wss:' : 'ws:'
  // Do not pass a query credential, fragment or URL userinfo to the proxy resolver.
  schemeTarget.username = ''
  schemeTarget.password = ''
  schemeTarget.search = ''
  schemeTarget.hash = ''
  const selection = await abortable(resolveProxy(schemeTarget, proxy), init.signal)
  init.signal?.throwIfAborted()
  const route = selection?.address
  if (diagnostic && selection) {
    diagnostic.proxyRoute = selection.address === 'direct' ? 'DIRECT' : selection.address
    diagnostic.automaticProxySource = selection.source
  }
  if (websocketPayload) {
    if (route && route !== 'direct' && !/^https?:\/\//.test(route))
      throw new ProviderTransportError('protocol_error')
    if (diagnostic) diagnostic.transport = 'responses_websocket'
    return fetchResponsesWebSocket(
      new URL(input instanceof Request ? input.url : input),
      init.headers,
      websocketPayload,
      init.signal ?? new AbortController().signal,
      route
    )
  }
  if (!route) {
    if (diagnostic) diagnostic.transport = 'node_fetch'
    return fetch(input, init)
  }
  const partition = await abortable(isolatedSession(route), init.signal).catch((error: unknown) => {
    throw new ProviderTransportError('proxy_error', error)
  })
  init.signal?.throwIfAborted()
  if (diagnostic) diagnostic.transport = 'electron_fetch'
  return partition.fetch(input instanceof URL ? input.href : input, {
    ...init,
    credentials: 'omit'
  })
}
