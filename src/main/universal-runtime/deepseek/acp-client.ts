/**
 * ACP client for DeepSeek Harness — one managed `dsh --profile acp` child.
 *
 * Uses the official `@agentclientprotocol/sdk` over newline-delimited JSON on
 * stdio (the same wire the DeepSeek ACP server implements). Process rules:
 * stdout is protocol traffic only; stderr is redacted diagnostics; teardown
 * runs stdin-EOF → grace → SIGTERM → grace → SIGKILL; Windows terminates via
 * taskkill; the child never outlives the host app.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import {
  client as createAcpClientApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type ContentBlock,
  type McpServer,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionOutcome,
  type SessionConfigOption,
  type SessionId,
  type SessionInfo,
  type SessionUpdate,
  type StopReason
} from '@agentclientprotocol/sdk'
import { redactSecretText } from '../../services/logger'
import { isWindowsScriptShim } from './spawn-safe'

const CLIENT_NAME = 'pi-harness'
const STDIN_EOF_GRACE_MS = 5_000
const SIGTERM_GRACE_MS = 3_000

export interface AcpChildSpawnSpec {
  command: string
  args: readonly string[]
  cwd: string
  env: Record<string, string>
}

export interface AcpPermissionPrompt {
  requestId: string
  sessionId: string
  toolCall: { title: string; kind: string }
  options: readonly { optionId: string; name: string; kind: string }[]
}

export interface AcpClientEvents {
  onStderr?: (line: string) => void
  onExit?: (code: number | null) => void
}

/** One ACP child process connection with graceful teardown semantics. */
export class AcpClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private connection: ClientConnection | null = null
  private pendingPermissions = new Map<string, (outcome: RequestPermissionOutcome) => void>()
  private updateHandler: ((sessionId: string, update: SessionUpdate) => void) | null = null
  private permissionHandler: ((prompt: AcpPermissionPrompt) => void) | null = null
  private stopped = false
  private stopping: Promise<void> | null = null

  constructor(
    private readonly spec: AcpChildSpawnSpec,
    private readonly events: AcpClientEvents = {}
  ) {}

  get running(): boolean {
    return this.child !== null && this.connection !== null && !this.stopped
  }

  onUpdate(handler: (sessionId: string, update: SessionUpdate) => void): void {
    this.updateHandler = handler
  }

  onPermissionRequest(handler: (prompt: AcpPermissionPrompt) => void): void {
    this.permissionHandler = handler
  }

  /** Spawn, connect, and complete the ACP initialize handshake. */
  async start(): Promise<void> {
    if (this.child) throw new Error('ACP client already started')
    const useComSpec = isWindowsScriptShim(this.spec.command)
    const command = useComSpec ? (process.env.ComSpec ?? 'cmd.exe') : this.spec.command
    const args = useComSpec
      ? ['/d', '/s', '/c', this.spec.command, ...this.spec.args]
      : [...this.spec.args]

    this.child = spawn(command, args, {
      cwd: this.spec.cwd,
      env: this.spec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: false,
      windowsHide: true
    }) as ChildProcessWithoutNullStreams

    // stderr is diagnostics only, redacted before logging.
    this.child.stderr.setEncoding('utf8')
    let stderrBuffer = ''
    this.child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk
      const lines = stderrBuffer.split('\n')
      stderrBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) this.events.onStderr?.(redactSecretText(trimmed))
      }
    })
    this.child.on('exit', (code) => {
      this.events.onExit?.(code)
      this.connection?.close()
    })

    const app = createAcpClientApp({ name: CLIENT_NAME })
      .onNotification(methods.client.session.update, ({ params }) => {
        this.updateHandler?.(params.sessionId, params.update)
        return Promise.resolve()
      })
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        return new Promise((resolve) => {
          const requestId = randomUUID()
          const prompt: AcpPermissionPrompt = {
            requestId,
            sessionId: params.sessionId,
            toolCall: {
              title: String(params.toolCall.title ?? ''),
              kind: String(params.toolCall.kind ?? 'other')
            },
            options: params.options.map((option) => ({
              optionId: option.optionId,
              name: option.name,
              kind: option.kind
            }))
          }
          this.pendingPermissions.set(requestId, resolve)
          try {
            this.permissionHandler?.(prompt)
          } catch {
            this.respondToPermission(requestId, { outcome: 'cancelled' })
          }
        })
      })

    this.connection = app.connect(
      ndJsonStream(
        Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>
      )
    )

    await this.connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {}
    })
  }

  /** Resolve a pending permission request (one-shot). */
  respondToPermission(requestId: string, outcome: RequestPermissionOutcome): void {
    const resolve = this.pendingPermissions.get(requestId)
    if (!resolve) return
    this.pendingPermissions.delete(requestId)
    resolve(outcome)
  }

  /** Cancel every unanswered permission request (e.g. on session teardown). */
  private cancelPendingPermissions(): void {
    for (const [, resolve] of this.pendingPermissions) resolve({ outcome: 'cancelled' })
    this.pendingPermissions.clear()
  }

  private agent(): ClientConnection['agent'] {
    if (!this.connection || !this.running) {
      throw new Error('DeepSeek Harness ACP connection is not running')
    }
    return this.connection.agent
  }

  async newSession(cwd: string, mcpServers: readonly McpServer[] = []): Promise<NewSessionResponse> {
    return this.agent().request(methods.agent.session.new, { cwd, mcpServers })
  }

  async prompt(sessionId: string, blocks: readonly ContentBlock[]): Promise<PromptResponse> {
    return this.agent().request(methods.agent.session.prompt, {
      sessionId,
      prompt: [...blocks]
    })
  }

  async cancel(sessionId: string): Promise<void> {
    await this.agent().notify(methods.agent.session.cancel, { sessionId })
  }

  async listSessions(): Promise<SessionInfo[]> {
    const response = await this.agent().request(methods.agent.session.list, {})
    return response.sessions
  }

  async resumeSession(sessionId: string): Promise<void> {
    await this.agent().request(methods.agent.session.resume, { sessionId })
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.agent().request(methods.agent.session.close, { sessionId })
  }

  async setSessionConfig(
    sessionId: string,
    configId: string,
    value: string
  ): Promise<void> {
    await this.agent().request(methods.agent.session.setConfigOption, {
      sessionId,
      configId,
      value
    })
  }

  /** Cooperative teardown ladder; safe to call multiple times. */
  async stop(): Promise<void> {
    if (this.stopped) return this.stopping ?? Promise.resolve()
    this.stopped = true
    this.stopping = (async () => {
      this.cancelPendingPermissions()
      const child = this.child
      try {
        this.connection?.close()
      } catch {
        /* already closed */
      }
      this.connection = null
      if (!child) return
      child.stdin.end()
      const exited = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), STDIN_EOF_GRACE_MS)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve(true)
        })
      })
      if (exited) {
        this.child = null
        return
      }
      if (process.platform === 'win32') {
        child.kill('SIGKILL')
      } else {
        child.kill('SIGTERM')
        const terminated = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), SIGTERM_GRACE_MS)
          child.once('exit', () => {
            clearTimeout(timer)
            resolve(true)
          })
        })
        if (!terminated) child.kill('SIGKILL')
      }
      this.child = null
    })()
    return this.stopping
  }

  /** Derive the current model from a session's `model` config options. */
  static currentModelFromConfig(
    configOptions: readonly SessionConfigOption[] | null | undefined
  ): { provider: string; modelId: string } | null {
    const modelOption = configOptions?.find((option) => option.configId === 'model')
    const selected = modelOption?.current?.type === 'select' ? modelOption.current : null
    const valueId = selected?.selected ?? null
    if (!valueId) return null
    for (const group of selected?.groups ?? []) {
      for (const option of group.options) {
        if (option.value === valueId) {
          return { provider: String(option._meta?.provider ?? ''), modelId: option.name }
        }
      }
    }
    return null
  }
}

export type { SessionId, StopReason }
