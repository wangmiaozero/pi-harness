import WebSocket from 'ws'
import { ConfigError } from '../services/errors'

/** Main-only authenticated sockets. Neither credentials nor raw peer errors cross IPC. */
export async function openSocket(url: string, headers: Record<string, string>): Promise<WebSocket> {
  const socket = new WebSocket(url, {
    headers,
    maxPayload: 1024 * 1024,
    handshakeTimeout: 12000,
    followRedirects: false
  })
  socket.on('error', () => undefined)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate()
        reject(new ConfigError('Connection timed out.'))
      }, 15000)
      const done = (error?: Error) => {
        clearTimeout(timer)
        socket.off('open', ready)
        socket.off('error', failed)
        socket.off('close', closed)
        if (error) reject(error)
        else resolve()
      }
      const ready = () => done()
      const failed = () =>
        done(new ConfigError('Connection failed. Check the address and credential.'))
      const closed = () => done(new ConfigError('Connection closed before it was ready.'))
      socket.once('open', ready)
      socket.once('error', failed)
      socket.once('close', closed)
    })
    return socket
  } catch (error) {
    socket.terminate()
    throw error
  }
}

export class RemoteRpc {
  private next = 0
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (e: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  constructor(readonly socket: WebSocket) {
    socket.on('message', (data, binary) => {
      if (binary) return this.close()
      try {
        const message = JSON.parse(data.toString())
        if (message.jsonrpc !== '2.0') return
        if (message.method && message.id !== undefined) {
          // No local execution or implicit approvals on behalf of the host.
          this.send({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: 'Client action unavailable' }
          })
          return
        }
        const pending = this.pending.get(message.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(message.id)
        if (message.error)
          pending.reject(
            new ConfigError(
              'The remote host refused this request. Check its permissions and status.'
            )
          )
        else pending.resolve(message.result)
      } catch {
        this.close()
      }
    })
    socket.on('close', () => this.rejectPending())
  }
  private rejectPending(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new ConfigError('The remote host disconnected. Reconnect to continue.'))
    }
    this.pending.clear()
  }
  private send(message: unknown): void {
    if (this.socket.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 1024 * 1024)
      throw new ConfigError('Connection unavailable.')
    this.socket.send(JSON.stringify(message))
  }
  request(method: string, params: unknown = {}): Promise<unknown> {
    if (this.pending.size >= 20)
      return Promise.reject(new ConfigError('Too many pending remote requests.'))
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new ConfigError('Remote request timed out.'))
      }, 15000)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (e) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(e)
      }
    })
  }
  notify(method: string): void {
    this.send({ jsonrpc: '2.0', method, params: {} })
  }
  close(): void {
    this.rejectPending()
    this.socket.terminate()
  }
}
