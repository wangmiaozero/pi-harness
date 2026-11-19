import { BlockList, isIP } from 'node:net'
import { resolveLoginShellProxyEnvironment } from '../environment/command-resolver'

let cached: { expires: number; result: Promise<NodeJS.ProcessEnv> } | undefined

export function loginProxyEnvironment() {
  if (!cached || cached.expires <= Date.now())
    cached = { expires: Date.now() + 30_000, result: resolveLoginShellProxyEnvironment() }
  return cached.result
}

export function proxyForTarget(target: URL, env: NodeJS.ProcessEnv) {
  const secure = target.protocol === 'https:' || target.protocol === 'wss:'
  const proxy = secure
    ? first(env.https_proxy, env.HTTPS_PROXY)
    : first(env.http_proxy, env.HTTP_PROXY)
  return proxy ?? first(env.all_proxy, env.ALL_PROXY)
}

function first(...values: (string | undefined)[]) {
  return values.map((value) => value?.trim()).find(Boolean)
}

export function bypassesProxy(target: URL, env: NodeJS.ProcessEnv) {
  const list = first(env.no_proxy, env.NO_PROXY)
  if (!list) return false
  const host = target.hostname.toLowerCase().replace(/\.$/, '')
  const address = host.replace(/^\[|\]$/g, '')
  const port = target.port || (['https:', 'wss:'].includes(target.protocol) ? '443' : '80')
  return list.split(',').some((item) => {
    const entry = item.trim().toLowerCase()
    if (entry === '*') return true
    const [network, prefix] = entry.split('/')
    if (prefix !== undefined) {
      const family = isIP(address)
      if (!family || isIP(network) !== family || !/^\d+$/.test(prefix)) return false
      const subnet = new BlockList()
      const type = family === 6 ? 'ipv6' : 'ipv4'
      if (Number(prefix) > (family === 6 ? 128 : 32)) return false
      subnet.addSubnet(network, Number(prefix), type)
      return subnet.check(address, type)
    }
    const match = /^(\[[\da-f:]+\]|[^:]+)(?::(\d+))?$/.exec(entry)
    if (!match || (match[2] && match[2] !== port)) return false
    const name = match[1].replace(/^\*?\./, '').replace(/\.$/, '')
    return !!name && (host === name || host.endsWith(`.${name}`))
  })
}

const localAddresses = new BlockList()
localAddresses.addSubnet('127.0.0.0', 8)
localAddresses.addSubnet('10.0.0.0', 8)
localAddresses.addSubnet('172.16.0.0', 12)
localAddresses.addSubnet('192.168.0.0', 16)
localAddresses.addSubnet('169.254.0.0', 16)
localAddresses.addAddress('0.0.0.0')
localAddresses.addAddress('::1', 'ipv6')
localAddresses.addAddress('::', 'ipv6')
localAddresses.addSubnet('fe80::', 10, 'ipv6')
localAddresses.addSubnet('fc00::', 7, 'ipv6')

export function isLocalProxyTarget(target: URL) {
  const host = target.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  const address = host.replace(/^\[|\]$/g, '')
  const family = isIP(address)
  return !!family && localAddresses.check(address, family === 6 ? 'ipv6' : 'ipv4')
}
