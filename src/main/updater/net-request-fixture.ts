import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { ClientRequest, ClientRequestConstructorOptions } from 'electron'

export type NetServer = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<Response>
export interface NetRequestRecord {
  options: ClientRequestConstructorOptions
  headers: Record<string, string>
  aborted: boolean
}

/**
 * Test double for Electron's net.request. Like Electron in `manual` redirect mode, a
 * redirect that is neither followed nor aborted during the event fails the request.
 */
export function fakeNetRequest(server: NetServer) {
  const requests: NetRequestRecord[] = []
  const request = (options: ClientRequestConstructorOptions) => {
    const client = new EventEmitter()
    const record: NetRequestRecord = { options, headers: {}, aborted: false }
    requests.push(record)
    let body: Readable | undefined
    Object.assign(client, {
      setHeader(name: string, value: string) {
        record.headers[name.toLowerCase()] = value
      },
      abort() {
        record.aborted = true
        body?.destroy()
      },
      followRedirect() {
        throw new Error('Release redirects must be validated by the caller, not followed')
      },
      end() {
        void (async () => {
          let response: Response
          try {
            response = await server(options.url!, { headers: { ...record.headers } })
          } catch (error) {
            if (!record.aborted) client.emit('error', error)
            return
          }
          if (record.aborted) return
          const location = response.headers.get('location')
          if (response.status >= 300 && response.status < 400 && location) {
            client.emit('redirect', response.status, 'GET', new URL(location, options.url).href, {})
            if (!record.aborted) client.emit('error', new Error('Redirect was cancelled'))
            return
          }
          body = response.body
            ? Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream)
            : Readable.from([])
          Object.assign(body, {
            statusCode: response.status,
            statusMessage: response.statusText,
            headers: Object.fromEntries(response.headers)
          })
          client.emit('response', body)
        })()
      }
    })
    return client as unknown as ClientRequest
  }
  return { request, requests }
}
