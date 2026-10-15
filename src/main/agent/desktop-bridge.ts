import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { AgentError } from '../services/errors'
import { inspectRuntimeError } from '@shared/workspace/runtime-error'

/** One authenticated OS-local socket per Pi process, with a fixed method allowlist in its host. */
export class DesktopBridge {
  private readonly token = randomBytes(32).toString('hex')
  private server: net.Server | null = null
  private socket: net.Socket | null = null
  private endpoint = ''
  private directory = ''
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  constructor(
    private readonly call: (method: string, params: Record<string, unknown>) => Promise<unknown>
  ) {}
  async start(root: string): Promise<NodeJS.ProcessEnv> {
    this.directory = await fs.mkdtemp(path.join(root, 'bridge-'))
    await fs.chmod(this.directory, 0o700)
    this.endpoint =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\pi-harness-${randomUUID()}`
        : path.join(this.directory, 'ipc')
    this.server = net.createServer((socket) => {
      let authenticated = false
      let buffer = ''
      const authTimeout = setTimeout(() => socket.destroy(), 5000)
      socket.setEncoding('utf8')
      socket.on('error', () => socket.destroy())
      socket.on('close', () => {
        clearTimeout(authTimeout)
        if (this.socket === socket) {
          this.socket = null
          for (const entry of this.pending.values()) {
            clearTimeout(entry.timer)
            entry.reject(new AgentError('Desktop extension disconnected'))
          }
          this.pending.clear()
        }
      })
      socket.on('data', (chunk: string) => {
        buffer += chunk
        if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) {
          socket.destroy()
          return
        }
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          let msg: Record<string, unknown>
          try {
            msg = JSON.parse(line)
          } catch {
            socket.destroy()
            return
          }
          if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
            socket.destroy()
            return
          }
          if (!authenticated) {
            if (msg.token !== this.token || this.socket) {
              socket.destroy()
              return
            }
            clearTimeout(authTimeout)
            authenticated = true
            this.socket = socket
            continue
          }
          if (typeof msg.id !== 'string') continue
          const pending = this.pending.get(msg.id)
          if (msg.type === 'response' && pending) {
            clearTimeout(pending.timer)
            this.pending.delete(msg.id)
            if (msg.error)
              pending.reject(new AgentError(inspectRuntimeError(String(msg.error)).userMessage))
            else pending.resolve(msg.data)
          } else if (msg.type === 'request' && typeof msg.method === 'string') {
            const params =
              msg.params && typeof msg.params === 'object'
                ? (msg.params as Record<string, unknown>)
                : {}
            void this.call(msg.method, params).then(
              (data) => socket.write(JSON.stringify({ type: 'response', id: msg.id, data }) + '\n'),
              (error) =>
                socket.write(
                  JSON.stringify({
                    type: 'response',
                    id: msg.id,
                    error: inspectRuntimeError(error).userMessage
                  }) + '\n'
                )
            )
          }
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.endpoint, resolve)
    })
    return { PI_HARNESS_DESKTOP_SOCKET: this.endpoint, PI_HARNESS_DESKTOP_TOKEN: this.token }
  }
  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.socket) throw new AgentError('Desktop extension is not connected')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new AgentError('Desktop extension request timed out'))
      }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket!.write(JSON.stringify({ type: 'request', id, method, params }) + '\n')
    })
  }
  async close(): Promise<void> {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new AgentError('Desktop bridge closed'))
    }
    this.pending.clear()
    this.socket?.destroy()
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    if (this.directory) await fs.rm(this.directory, { force: true, recursive: true })
  }
}
