/**
 * DeepSeekRuntimeAdapter — Phase 3 of the Universal Runtime Kernel.
 *
 * Second engine adapter, integrated exclusively through DeepSeek Harness's
 * official public automation surface: the ACP v1 stdio server started by
 * `dsh --profile acp` (npm package `@deepseek-ai/dsh`). The agent loop, Cordis
 * runtime, profiles, sessions and credentials stay inside the child process
 * and its isolated `DSH_HOME`; Pi-Harness only speaks the documented wire.
 *
 * Isolation guarantees:
 * - Independent `DSH_HOME` under this runtime's dataDir (never `~/.dsh`).
 * - Ambient secret-shaped environment variables are NOT forwarded.
 * - One managed child process; stdout carries protocol frames only.
 * - Graceful, bounded teardown on disable/quit; the child never outlives the
 *   host app.
 *
 * Capability declarations mirror exactly what `dsh --profile acp` advertises
 * (see docs/integrations/deepseek-harness.md); unsupported capabilities such
 * as fork, checkpoint or replay are NOT declared.
 */

import path from 'node:path'
import type {
  AgentRuntimeAdapter,
  CreateSessionOptions,
  RuntimeCapabilities,
  RuntimeContext,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeExecution,
  RuntimeHealth,
  RuntimePromptMessage,
  RuntimeSessionHandle,
  RuntimeSessionSummary
} from '@shared/universal-runtime'
import type {
  ContentBlock,
  McpServer,
  SessionConfigOption,
  SessionUpdate
} from '@agentclientprotocol/sdk'
import { AcpClient, type AcpPermissionPrompt } from './acp-client'
import {
  acpServerArgs,
  detectDeepSeekHarness,
  resolveDshCommand,
  type DeepSeekDetectOptions
} from './deepseek-detect'

export const DEEPSEEK_RUNTIME_ID = 'deepseek'

/**
 * Capabilities actually provided by `dsh --profile acp` (ACP v1):
 * session create/list/resume/close, prompt + cancel, streaming (committed
 * chunks), thoughts, generic tool lifecycle, model + reasoning-effort
 * config options, stdio/HTTP MCP mounts, and permission prompts.
 */
export const DEEPSEEK_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  supported: [
    'session.create',
    'session.list',
    'session.resume',
    'session.close',
    'prompt.send',
    'prompt.cancel',
    'streaming',
    'thinking',
    'tool.calls',
    'model.selection',
    'model.reasoning',
    'mcp',
    'permission.requests'
  ]
}

const SECRET_ENV_RE = /(api[-_]?key|authorization|^auth$|token|secret|password|credential)/i

interface DeepSeekSession {
  sessionId: string
  cwd: string
  listeners: Set<RuntimeEventListener>
  running: boolean
  model: { provider: string; modelId: string } | null
  /** Accumulated assistant text per ACP messageId, for message.completed. */
  messages: Map<string, string>
  startedMessages: Set<string>
  /** `model` config catalog published at session creation/resume. */
  configOptions: readonly SessionConfigOption[]
}

export interface DeepSeekRuntimeOptions {
  /** User-configured `dsh` executable path (settings); null = auto-detect. */
  customPath?: string | null | (() => string | null | undefined)
  /** Explicit env overrides forwarded to the child (opt-in only). */
  envExtras?: Record<string, string>
  /** Test seam for detection. */
  detectOptions?: DeepSeekDetectOptions
}

function resolveCustomPath(
  value: DeepSeekRuntimeOptions['customPath']
): string | null | undefined {
  return typeof value === 'function' ? value() : value
}

export class DeepSeekRuntimeAdapter implements AgentRuntimeAdapter {
  readonly id = DEEPSEEK_RUNTIME_ID
  readonly name = 'DeepSeek Harness'
  readonly description = 'DeepSeek Harness agent via ACP (dsh --profile acp)'

  private context: RuntimeContext | null = null
  private client: AcpClient | null = null
  private sessions = new Map<string, DeepSeekSession>()
  private pendingPermissions = new Map<string, AcpPermissionPrompt>()
  private detection: Awaited<ReturnType<typeof detectDeepSeekHarness>> | null = null
  private nextSequence = 0
  private startingClient: Promise<AcpClient> | null = null
  private readonly options: DeepSeekRuntimeOptions

  constructor(options: DeepSeekRuntimeOptions = {}) {
    this.options = options
  }

  getCapabilities(): RuntimeCapabilities {
    return DEEPSEEK_RUNTIME_CAPABILITIES
  }

  async initialize(context: RuntimeContext): Promise<void> {
    this.context = context
  }

  async healthCheck(): Promise<RuntimeHealth> {
    const detection =
      this.detection ??
      (this.detection = await detectDeepSeekHarness({
        ...this.options.detectOptions,
        customPath: resolveCustomPath(this.options.customPath) ?? this.options.detectOptions?.customPath ?? null
      }))
    return {
      status: detection.status === 'installed' ? 'ok' : 'unavailable',
      installState: detection.status,
      version: detection.version,
      message: detection.message,
      checkedAt: Date.now()
    }
  }

  /** Detectable without enabling: used by settings UI before opt-in. */
  async detect(): Promise<DeepSeekRuntimeAdapter['detection']> {
    if (!this.detection) {
      this.detection = await detectDeepSeekHarness({
        ...this.options.detectOptions,
        customPath: resolveCustomPath(this.options.customPath) ?? this.options.detectOptions?.customPath ?? null
      })
    }
    return this.detection
  }

  /** Drop the cached detection so the next health check probes again. */
  invalidateDetection(): void {
    this.detection = null
  }

  async dispose(): Promise<void> {
    await this.stopClient()
    this.sessions.clear()
    this.pendingPermissions.clear()
  }

  // -- session surface --------------------------------------------------

  async createSession(options: CreateSessionOptions): Promise<RuntimeSessionHandle> {
    const client = await this.ensureClient()
    const mcpServers = this.toAcpMcpServers(options.mcpServers)
    const created = await client.newSession(options.cwd, mcpServers)
    const session: DeepSeekSession = {
      sessionId: created.sessionId,
      cwd: options.cwd,
      listeners: new Set(),
      running: false,
      model: AcpClient.currentModelFromConfig(created.configOptions ?? []),
      messages: new Map(),
      startedMessages: new Set(),
      configOptions: created.configOptions ?? []
    }
    this.sessions.set(session.sessionId, session)
    this.emit(session, {
      type: 'session.created',
      provenance: this.prov(session),
      cwd: options.cwd,
      model: session.model
    })
    if (options.message?.text) await this.sendMessage(session.sessionId, options.message)
    return {
      sessionId: session.sessionId,
      cwd: session.cwd,
      reference: `${DEEPSEEK_RUNTIME_ID}:${session.sessionId}`,
      model: session.model
    }
  }

  async resumeSession(
    sessionId: string,
    resume?: { cwd?: string }
  ): Promise<RuntimeSessionHandle> {
    const client = await this.ensureClient()
    const existing = this.sessions.get(sessionId)
    if (existing) return this.handleOf(existing)
    const cwd = resume?.cwd ?? (await this.lookupCwd(sessionId))
    if (!cwd) throw new Error('DeepSeek session workspace is unknown; open it from its project')
    await client.resumeSession(sessionId)
    const session: DeepSeekSession = {
      sessionId,
      cwd,
      listeners: new Set(),
      running: false,
      model: null,
      messages: new Map(),
      startedMessages: new Set(),
      configOptions: []
    }
    this.sessions.set(sessionId, session)
    return this.handleOf(session)
  }

  async sendMessage(sessionId: string, message: RuntimePromptMessage): Promise<RuntimeExecution> {
    const session = this.requireSession(sessionId)
    if (message.images?.length) {
      throw new Error('DeepSeek Harness ACP sessions do not accept image prompts here yet')
    }
    if (session.running) {
      throw new Error('A prompt is already running in this DeepSeek session')
    }
    const client = await this.ensureClient()
    const executionId = `dsh-exec-${++this.nextSequence}`
    session.running = true
    this.emit(session, {
      type: 'agent.started',
      provenance: this.prov(session, executionId)
    })
    const blocks: ContentBlock[] = [{ type: 'text', text: message.text }]
    void client
      .prompt(sessionId, blocks)
      .then((response) => {
        session.running = false
        this.emitMessageCompletions(session, executionId)
        this.emit(session, {
          type: 'agent.completed',
          provenance: this.prov(session, executionId),
          stopReason: response.stopReason
        })
      })
      .catch((error: unknown) => {
        session.running = false
        this.emitMessageCompletions(session, executionId)
        this.emit(session, {
          type: 'agent.failed',
          provenance: this.prov(session, executionId),
          error: {
            message: error instanceof Error ? error.message : String(error),
            recoverable: true
          }
        })
      })
    return { executionId }
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId)
    const client = await this.ensureClient()
    await client.cancel(sessionId)
    session.running = false
    this.emit(session, { type: 'execution.cancelled', provenance: this.prov(session) })
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    const client = this.client
    if (client?.running) await client.closeSession(sessionId).catch(() => {})
    if (session) {
      this.emit(session, { type: 'session.completed', provenance: this.prov(session) })
      session.listeners.clear()
      this.sessions.delete(sessionId)
    }
  }

  async listSessions(): Promise<RuntimeSessionSummary[]> {
    const client = await this.ensureClient()
    const infos = await client.listSessions()
    return infos.map((info) => ({
      sessionId: info.sessionId,
      createdAt: null,
      updatedAt: info.updatedAt ? Date.parse(info.updatedAt) || null : null,
      cwd: info.cwd ?? null,
      title: info.title ?? undefined,
      model: null
    }))
  }

  isRunning(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.running ?? false
  }

  subscribe(sessionId: string, listener: RuntimeEventListener): () => void {
    const session = this.sessions.get(sessionId)
    if (!session) return () => {}
    session.listeners.add(listener)
    return () => session.listeners.delete(listener)
  }

  async respondToPermission(requestId: string, outcome: string): Promise<void> {
    const client = this.client
    if (!client) return
    const prompt = this.pendingPermissions.get(requestId)
    this.pendingPermissions.delete(requestId)
    if (outcome === 'cancelled' || !prompt) {
      client.respondToPermission(requestId, { outcome: 'cancelled' })
      return
    }
    const option = prompt.options.find((candidate) => candidate.optionId === outcome)
    if (!option) {
      client.respondToPermission(requestId, { outcome: 'cancelled' })
      return
    }
    client.respondToPermission(requestId, { outcome: 'selected', optionId: option.optionId })
    const session = this.sessions.get(prompt.sessionId)
    if (session) {
      this.emit(session, {
        type: 'permission.responded',
        provenance: this.prov(session),
        requestId,
        outcome: option.optionId
      })
    }
  }

  /** Apply a model config choice via session/set_config_option. */
  async setModel(
    sessionId: string,
    model: { provider?: string; modelId?: string }
  ): Promise<void> {
    const session = this.requireSession(sessionId)
    const client = await this.ensureClient()
    const valueId = this.resolveModelValue(session, model)
    await client.setSessionConfig(sessionId, 'model', valueId)
    session.model = { provider: model.provider ?? '', modelId: model.modelId ?? '' }
    this.emit(session, {
      type: 'session.updated',
      provenance: this.prov(session),
      cwd: session.cwd,
      model: session.model
    })
  }

  // -- internals --------------------------------------------------------

  private handleOf(session: DeepSeekSession): RuntimeSessionHandle {
    return {
      sessionId: session.sessionId,
      cwd: session.cwd,
      reference: `${DEEPSEEK_RUNTIME_ID}:${session.sessionId}`,
      model: session.model
    }
  }

  private requireSession(sessionId: string): DeepSeekSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`DeepSeek session not found: ${sessionId}`)
    return session
  }

  private async lookupCwd(sessionId: string): Promise<string | null> {
    const client = await this.ensureClient()
    const infos = await client.listSessions()
    return infos.find((info) => info.sessionId === sessionId)?.cwd ?? null
  }

  /**
   * Match a requested provider/model against the session's published `model`
   * config catalog and return its opaque ACP value id.
   */
  private resolveModelValue(
    session: DeepSeekSession,
    wanted: { provider?: string; modelId?: string }
  ): string {
    const option = session.configOptions.find((candidate) => candidate.configId === 'model')
    const select = option?.current?.type === 'select' ? option.current : null
    for (const group of select?.groups ?? []) {
      for (const candidate of group.options) {
        const meta = candidate._meta as { provider?: unknown; model?: unknown } | null
        const provider = typeof meta?.provider === 'string' ? meta.provider : ''
        const modelId =
          typeof meta?.model === 'string' ? meta.model : String(candidate.name ?? '')
        const providerMatches = !wanted.provider || !provider || provider === wanted.provider
        if (providerMatches && modelId === wanted.modelId) return candidate.value
      }
    }
    throw new Error(
      `Model is not available in this DeepSeek session: ${wanted.provider ?? ''}/${wanted.modelId ?? ''}`
    )
  }

  /** Lazily start (and memoize) the ACP child process. */
  private async ensureClient(): Promise<AcpClient> {
    if (this.client?.running) return this.client
    if (this.startingClient) return this.startingClient
    const resolved = await resolveDshCommand({
      ...this.options.detectOptions,
      customPath: resolveCustomPath(this.options.customPath) ?? this.options.detectOptions?.customPath ?? null
    })
    if (!resolved) {
      throw new Error(
        'DeepSeek Harness (dsh) is not installed. Install @deepseek-ai/dsh and enable the runtime in settings.'
      )
    }
    if (!this.context) {
      throw new Error('DeepSeek runtime is not initialized')
    }
    this.startingClient = (async () => {
      const client = new AcpClient(
        {
          command: resolved.command,
          args: acpServerArgs(),
          cwd: this.context!.dataDir,
          env: this.childEnv(this.context!.dataDir)
        },
        {
          onStderr: (line) => this.context?.log.warn('dsh stderr:', line),
          onExit: (code) => {
            this.context?.log.warn(`dsh ACP server exited with code ${code ?? 'null'}`)
            this.client = null
          }
        }
      )
      client.onUpdate((sessionId, update) => this.handleUpdate(sessionId, update))
      client.onPermissionRequest((prompt) => {
        this.pendingPermissions.set(prompt.requestId, prompt)
        const session = this.sessions.get(prompt.sessionId)
        if (session) {
          this.emit(session, {
            type: 'permission.requested',
            provenance: this.prov(session),
            request: {
              requestId: prompt.requestId,
              sessionId: prompt.sessionId,
              title: prompt.toolCall.title,
              kind: prompt.toolCall.kind,
              options: prompt.options.map((option) => ({
                id: option.optionId,
                name: option.name
              }))
            }
          })
        } else {
          // No subscriber: never silently approve.
          client.respondToPermission(prompt.requestId, { outcome: 'cancelled' })
          this.pendingPermissions.delete(prompt.requestId)
        }
      })
      await client.start()
      this.client = client
      return client
    })()
    try {
      return await this.startingClient
    } finally {
      this.startingClient = null
    }
  }

  /**
   * Child environment: the ambient environment minus secret-shaped keys, with
   * an isolated `DSH_HOME` under this runtime's dataDir. Users opt in to
   * credential forwarding explicitly via `envExtras` (settings).
   */
  private childEnv(dataDir: string): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue
      if (SECRET_ENV_RE.test(key)) continue
      env[key] = value
    }
    env.DSH_HOME = path.join(dataDir, 'dsh-home')
    for (const [key, value] of Object.entries(this.options.envExtras ?? {})) {
      env[key] = value
    }
    return env
  }

  private async stopClient(): Promise<void> {
    const client = this.client
    this.client = null
    if (client) await client.stop()
  }

  private handleUpdate(sessionId: string, update: SessionUpdate): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const messageId = update.messageId ?? ''
        const text = update.content.type === 'text' ? update.content.text : ''
        if (!session.startedMessages.has(messageId)) {
          session.startedMessages.add(messageId)
          session.messages.set(messageId, text)
          this.emit(session, {
            type: 'message.started',
            provenance: this.prov(session),
            role: 'assistant'
          })
        } else {
          session.messages.set(messageId, (session.messages.get(messageId) ?? '') + text)
        }
        this.emit(session, {
          type: 'message.delta',
          provenance: this.prov(session),
          delta: { delta: text }
        })
        break
      }
      case 'agent_thought_chunk': {
        const text = update.content.type === 'text' ? update.content.text : ''
        this.emit(session, {
          type: 'message.thought',
          provenance: this.prov(session),
          delta: { delta: text }
        })
        break
      }
      case 'tool_call': {
        this.emit(session, {
          type: 'tool.started',
          provenance: this.prov(session),
          toolCall: {
            toolCallId: update.toolCallId,
            toolName: update.title ?? 'tool',
            input: (update.rawInput as Record<string, unknown> | undefined) ?? {}
          }
        })
        break
      }
      case 'tool_call_update': {
        if (update.status === 'completed' || update.status === 'failed') {
          const text = (update.content ?? [])
            .map((block) => (block.type === 'content' && block.content.type === 'text' ? block.content.text : ''))
            .join('\n')
          this.emit(session, {
            type: update.status === 'completed' ? 'tool.completed' : 'tool.failed',
            provenance: this.prov(session),
            result: {
              toolCallId: update.toolCallId,
              toolName: update.title ?? undefined,
              isError: update.status === 'failed',
              content: { text }
            }
          })
        }
        break
      }
      case 'config_update': {
        const model = AcpClient.currentModelFromConfig(
          update.configOptions as readonly SessionConfigOption[]
        )
        if (model) session.model = model
        this.emit(session, {
          type: 'session.updated',
          provenance: this.prov(session),
          cwd: session.cwd,
          model: session.model
        })
        break
      }
      default:
        // user_message_chunk / plan / available_commands / current_mode /
        // usage / compaction: consumed but not mapped — no fake capability.
        break
    }
  }

  /** Emit message.completed for every accumulated assistant message of a turn. */
  private emitMessageCompletions(session: DeepSeekSession, executionId: string): void {
    for (const [messageId, text] of session.messages) {
      this.emit(session, {
        type: 'message.completed',
        provenance: this.prov(session, executionId),
        role: 'assistant',
        content: { text },
        model: session.model,
        stopReason: 'end_turn'
      })
      void messageId
    }
    session.messages.clear()
    session.startedMessages.clear()
  }

  private toAcpMcpServers(
    descriptors: readonly CreateSessionOptions['mcpServers'] | undefined
  ): McpServer[] {
    if (!descriptors?.length) return []
    return descriptors
      .filter((descriptor) => descriptor.command || descriptor.url)
      .map((descriptor) =>
        descriptor.command
          ? {
              type: 'stdio',
              name: descriptor.name,
              command: descriptor.command,
              args: [...(descriptor.args ?? [])],
              ...(descriptor.env ? { env: descriptor.env } : {})
            }
          : {
              type: 'http',
              name: descriptor.name,
              url: descriptor.url!
            }
      )
  }

  private prov(session: DeepSeekSession, executionId?: string) {
    return {
      runtimeId: this.id,
      nativeSessionId: session.sessionId,
      sequence: ++this.nextSequence,
      timestamp: Date.now(),
      ...(executionId ? { executionId } : {})
    }
  }

  private emit(session: DeepSeekSession, event: RuntimeEvent): void {
    for (const listener of session.listeners) {
      try {
        listener(event)
      } catch (error) {
        this.context?.log.error('listener failed:', error)
      }
    }
  }
}
