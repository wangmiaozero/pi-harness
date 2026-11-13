import type { ProviderAdvancedSettings } from '@shared/providers/advanced-settings'
import { systemFetch } from './system-fetch'

const customSessions = new Map<string, Promise<import('electron').Session>>()

export async function resolveWebSocketProxy(
  target: URL,
  proxy: ProviderAdvancedSettings['proxy']
): Promise<string | undefined> {
  if (!proxy || proxy.mode === 'direct') return
  if (proxy.mode === 'custom') {
    if (!/^https?:\/\//.test(proxy.url))
      throw new Error('Responses WebSocket requires an HTTP proxy')
    return proxy.url
  }
  const { session } = await import('electron')
  const routes = await session.defaultSession.resolveProxy(target.href)
  const route = routes.split(';')[0]?.trim()
  if (!route || route === 'DIRECT') return
  const match = /^(PROXY|HTTPS) ([^\s]+)$/.exec(route)
  if (!match) throw new Error('Responses WebSocket requires an HTTP proxy')
  return `${match[1] === 'HTTPS' ? 'https' : 'http'}://${match[2]}`
}

export async function fetchProvider(
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  proxy?: ProviderAdvancedSettings['proxy']
): Promise<Response> {
  if (!proxy) return fetch(input, init)
  if (proxy.mode === 'system') return systemFetch(input, init)
  const key = proxy.mode === 'direct' ? 'direct' : proxy.url
  let pending = customSessions.get(key)
  if (!pending) {
    // Use a non-persistent Electron session so changing one provider's proxy does not affect others.
    const name = `provider-network-${crypto.randomUUID()}`
    pending = import('electron').then(async ({ session }) => {
      const partition = session.fromPartition(name, { cache: false })
      await partition.setProxy(
        proxy.mode === 'direct'
          ? { mode: 'direct' }
          : { mode: 'fixed_servers', proxyRules: proxy.url, proxyBypassRules: '<-loopback>' }
      )
      return partition
    })
    customSessions.set(key, pending)
    void pending.catch(() => customSessions.delete(key))
  }
  return (await pending).fetch(input instanceof URL ? input.href : input, init)
}
