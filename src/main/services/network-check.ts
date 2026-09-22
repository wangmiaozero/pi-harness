import { net } from 'electron'
import type { NetworkCheckResult } from '@shared/ipc/api-types'

const NPM_PING_URL = 'https://registry.npmjs.org/-/ping'
const TIMEOUT_MS = 2500

export async function checkNetwork(
  request: (signal: AbortSignal) => Promise<{ ok: boolean }> = (signal) =>
    net.fetch(NPM_PING_URL, { signal, cache: 'no-store' })
): Promise<NetworkCheckResult> {
  const controller = new AbortController()
  const startedAt = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const response = await Promise.race([
      request(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('Network check timed out'))
        }, TIMEOUT_MS)
      })
    ])
    return {
      reachable: response.ok,
      latencyMs: response.ok ? Math.round(performance.now() - startedAt) : null
    }
  } catch {
    return { reachable: false, latencyMs: null }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
