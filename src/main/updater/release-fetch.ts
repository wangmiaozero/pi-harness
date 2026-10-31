import { Readable } from 'node:stream'
import type { ClientRequest, ClientRequestConstructorOptions, IncomingMessage } from 'electron'
import type { ReleaseFetcher } from './security/transport.mjs'

export type NetRequest = (options: ClientRequestConstructorOptions) => ClientRequest

const nullBodyStatus = new Set([101, 103, 204, 205, 304])

/**
 * Release transport over Electron's network stack, which keeps the system proxy and
 * certificate settings. Electron's net.fetch rejects every redirect in `manual` mode
 * ("Redirect was cancelled") instead of returning it, so GitHub's release-to-CDN hop could
 * never be validated. Here each redirect is returned unfollowed as a 3xx Response and
 * fetchOfficial decides whether the next hop is trusted.
 */
export function createReleaseFetcher(request: NetRequest): ReleaseFetcher {
  return (url, init = {}) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal ?? undefined
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      if (init.method && init.method.toUpperCase() !== 'GET') {
        reject(new Error('Release requests must use GET'))
        return
      }
      let settled = false
      const settle = (action: () => void) => {
        if (settled) return
        settled = true
        action()
      }
      const client = request({
        url,
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store'
      })
      const abort = () => {
        client.abort()
        settle(() => reject(signal!.reason))
      }
      const release = () => signal?.removeEventListener('abort', abort)
      const fail = (error: unknown) => {
        release()
        client.abort()
        settle(() => reject(error))
      }
      signal?.addEventListener('abort', abort, { once: true })
      client.on('redirect', (status, _method, location) => {
        release()
        // Aborting inside the handler also stops Electron from failing the cancelled hop.
        client.abort()
        settle(() => resolve(new Response(null, { status, headers: { location } })))
      })
      client.on('response', (message: IncomingMessage) => {
        try {
          const headers = new Headers()
          for (const [name, value] of Object.entries(message.headers))
            headers.set(name, Array.isArray(value) ? value.join(', ') : value)
          // Electron types IncomingMessage narrowly, but at runtime it is a Node Readable.
          const stream = message as unknown as Readable
          let ended = false
          stream.once('end', () => {
            ended = true
          })
          stream.once('close', () => {
            release()
            // A cancelled body must not keep downloading a large installer in the background.
            if (!ended) client.abort()
          })
          const empty = nullBodyStatus.has(message.statusCode)
          if (empty) stream.resume()
          const body = empty
            ? null
            : (Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>)
          settle(() =>
            resolve(
              new Response(body, {
                status: message.statusCode,
                statusText: message.statusMessage,
                headers
              })
            )
          )
        } catch (error) {
          fail(error)
        }
      })
      client.on('error', (error) => {
        release()
        settle(() => reject(error))
      })
      try {
        new Headers(init.headers).forEach((value, name) => client.setHeader(name, value))
        client.end()
      } catch (error) {
        fail(error)
      }
    })
}
