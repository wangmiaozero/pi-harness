import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { AgentError } from '../services/errors'
import { inspectRuntimeError } from '@shared/workspace/runtime-error'

/** Official JSONL RPC transport. Correlation, bounded output and exit cleanup live here. */
export class PiRpcClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private listeners = new Set<(event: Record<string, unknown>) => void>()
  private exitListeners = new Set<() => void>()
  private closed = false
  private buffer = ''
  private stderr = ''
  private readonly decoder = new StringDecoder('utf8')

  start(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
    if (this.child || this.closed) throw new AgentError('Pi process has already been started')
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    child.stdout.on('data', (data: Buffer) => this.read(this.decoder.write(data)))
    child.stderr.on('data', (data: Buffer) => {
      // Retain only a bounded tail. Never log raw extension/provider output.
      this.stderr = (this.stderr + data.toString('utf8')).slice(-8192)
    })
    child.stdin.on('error', () => this.fail(new AgentError('Pi RPC input disconnected')))
    child.once('error', () => this.fail(new AgentError('Pi executable could not be started')))
    child.once('close', (code) => {
      this.fail(new AgentError(`Pi process exited (${code ?? 'signal'})`))
      for (const listener of this.exitListeners) listener()
    })
  }
  onEvent(listener: (event: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  onExit(listener: () => void): void {
    this.exitListeners.add(listener)
  }
  async request(command: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed || !this.child) throw new AgentError('Pi process is disconnected')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new AgentError('Pi RPC request timed out'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ ...command, id })
    })
  }
  write(command: Record<string, unknown>): void {
    if (this.closed || !this.child?.stdin.writable)
      throw new AgentError('Pi process is disconnected')
    this.child.stdin.write(JSON.stringify(command) + '\n')
  }
  async stop(): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
    child.stdin.end()
    const timer = setTimeout(() => child.kill('SIGTERM'), 1500)
    const force = setTimeout(() => child.kill('SIGKILL'), 5000)
    try {
      await exited
    } finally {
      clearTimeout(timer)
      clearTimeout(force)
    }
  }
  private read(chunk: string): void {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer) > 32 * 1024 * 1024) {
      this.fail(new AgentError('Pi RPC output exceeded the limit'))
      this.child?.kill()
      return
    }
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (!line.trim()) continue
      let event: Record<string, unknown>
      try {
        event = JSON.parse(line)
      } catch {
        this.fail(new AgentError('Pi returned invalid RPC output'))
        this.child?.kill()
        return
      }
      if (!event || typeof event !== 'object') continue
      if (event.type === 'response' && typeof event.id === 'string') {
        const pending = this.pending.get(event.id)
        if (!pending) continue
        this.pending.delete(event.id)
        clearTimeout(pending.timer)
        if (event.success === true) pending.resolve(event.data)
        else
          pending.reject(
            new AgentError(
              inspectRuntimeError(String(event.error ?? 'Pi command failed')).userMessage
            )
          )
      } else for (const listener of this.listeners) listener(event)
    }
  }
  private fail(error: Error): void {
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
