/**
 * PiRuntimeAdapter — Phase 2 of the Universal Runtime Kernel.
 *
 * Composes the *existing* `AgentRuntime` boundary (SDK-mode
 * AgentRuntimeService or RPC-mode PiRpcRuntime) behind the universal adapter
 * contract. The Pi agent loop, native sessions, extensions, MCP, skills and
 * all governance stay exactly where they are: this adapter delegates to the
 * very same runtime instance used by every existing flow, so there is one
 * owner per Pi session. It never re-implements Pi behavior and never depends
 * on the Pi SDK directly.
 */

import type {
  AgentRuntimeAdapter,
  RuntimeCapabilities,
  RuntimeContext,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeExecution,
  RuntimeHealth,
  RuntimePromptMessage,
  RuntimeSessionHandle,
  RuntimeSessionSummary,
  CreateSessionOptions
} from '@shared/universal-runtime'
import type { AgentRuntime } from '../../agent/runtime'
import type { SessionInfo } from '@shared/types/workspace'

/** The existing runtime boundary plus its native event subscription. */
export interface PiRuntimeBoundary extends AgentRuntime {
  subscribe(
    sessionId: string,
    listener: (event: { type: string; [key: string]: unknown }) => void
  ): () => void
}

/** Full native surface Pi implements today — never over-claimed. */
export const PI_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  supported: [
    'session.create',
    'session.list',
    'session.resume',
    'session.fork',
    'prompt.send',
    'prompt.cancel',
    'streaming',
    'thinking',
    'tool.calls',
    'model.selection',
    'model.reasoning',
    'mcp',
    'skills',
    'extensions',
    'trace',
    'replay',
    'checkpoint',
    'recovery',
    'multiAgent',
    'worktree',
    'images'
  ]
}

export interface PiRuntimeAdapterDeps {
  /** The live Pi runtime instance shared with all existing services. */
  runtime: PiRuntimeBoundary
  /** Session listing from the native Pi JSONL session store. */
  listSessions: () => Promise<SessionInfo[]>
  /** Cheap SDK/process probe used by health checks. */
  probe: () => { sdkLoaded: boolean; version: string | null }
}

const PROV = 'pi'

export class PiRuntimeAdapter implements AgentRuntimeAdapter {
  readonly id = 'pi'
  readonly name = 'Pi Coding Agent'
  readonly description = 'Default agent runtime bundled with Pi-Harness'

  constructor(private readonly deps: PiRuntimeAdapterDeps) {}

  getCapabilities(): RuntimeCapabilities {
    return PI_RUNTIME_CAPABILITIES
  }

  async initialize(): Promise<void> {
    // The Pi runtime is lazily initialized by its owner; nothing to do here.
  }

  async healthCheck(): Promise<RuntimeHealth> {
    const { sdkLoaded, version } = this.deps.probe()
    return {
      status: sdkLoaded ? 'ok' : 'unavailable',
      installState: sdkLoaded ? 'installed' : 'unknown',
      version,
      message: sdkLoaded ? null : 'Pi runtime is not loaded yet',
      checkedAt: Date.now()
    }
  }

  async dispose(): Promise<void> {
    // Disposal of the Pi runtime is owned by the app shutdown sequence.
  }

  async createSession(options: CreateSessionOptions): Promise<RuntimeSessionHandle> {
    const started = await this.deps.runtime.start({
      cwd: options.cwd,
      ...(options.message?.text ? { message: options.message.text } : {}),
      ...(options.model?.provider && options.model?.modelId
        ? { provider: options.model.provider, modelId: options.model.modelId }
        : {})
    })
    const state = await this.deps.runtime.getState(started.sessionId)
    return {
      sessionId: started.sessionId,
      cwd: started.cwd,
      reference: state?.sessionFile,
      model: state?.model
        ? { provider: state.model.provider, modelId: state.model.id }
        : null
    }
  }

  async resumeSession(
    sessionId: string,
    options?: { cwd?: string }
  ): Promise<RuntimeSessionHandle> {
    const started = await this.deps.runtime.start({ sessionId })
    const state = await this.deps.runtime.getState(started.sessionId)
    return {
      sessionId: started.sessionId,
      cwd: options?.cwd ?? started.cwd,
      reference: state?.sessionFile,
      model: state?.model
        ? { provider: state.model.provider, modelId: state.model.id }
        : null
    }
  }

  async sendMessage(sessionId: string, message: RuntimePromptMessage): Promise<RuntimeExecution> {
    await this.deps.runtime.prompt(sessionId, message.text, {
      images: message.images
    })
    return { executionId: `pi-exec-${Date.now().toString(36)}` }
  }

  async cancel(sessionId: string): Promise<void> {
    await this.deps.runtime.abort(sessionId)
  }

  async listSessions(): Promise<RuntimeSessionSummary[]> {
    const sessions = await this.deps.listSessions()
    return sessions.map((session) => ({
      sessionId: session.id,
      createdAt: Date.parse(session.created) || null,
      updatedAt: Date.parse(session.modified) || null,
      cwd: session.cwd ?? null,
      title: session.name,
      model: null
    }))
  }

  isRunning(sessionId: string): boolean {
    return this.deps.runtime.listRunning().includes(sessionId)
  }

  subscribe(sessionId: string, listener: RuntimeEventListener): () => void {
    let sequence = 0
    const next = (): number => ++sequence
    const provenance = () => ({
      runtimeId: PROV,
      nativeSessionId: sessionId,
      sequence: next(),
      timestamp: Date.now()
    })
    const unsubscribe = this.deps.runtime.subscribe(sessionId, (event) => {
      const mapped = toRuntimeEvent(event, provenance)
      if (mapped) listener(mapped)
    })
    return unsubscribe
  }
}

/** Map a Pi-native AgentEvent onto the unified RuntimeEvent model. */
export function toRuntimeEvent(
  event: { type: string; [key: string]: unknown },
  provenance: () => {
    runtimeId: string
    nativeSessionId: string
    sequence: number
    timestamp: number
  }
): RuntimeEvent | null {
  switch (event.type) {
    case 'agent_start':
      return { type: 'agent.started', provenance: provenance() }
    case 'agent_end':
      return { type: 'agent.completed', provenance: provenance() }
    case 'message_start': {
      const message = event.message as { role?: unknown } | undefined
      if (message?.role !== 'assistant') return null
      return { type: 'message.started', provenance: provenance(), role: 'assistant' }
    }
    case 'message_update': {
      const wire = event as {
        assistantMessageEvent?: { delta?: unknown; partial?: unknown }
        message?: { content?: unknown; model?: unknown; provider?: unknown }
      }
      const delta =
        typeof wire.assistantMessageEvent?.delta === 'string'
          ? wire.assistantMessageEvent.delta
          : null
      if (delta === null) return null
      return { type: 'message.delta', provenance: provenance(), delta: { delta } }
    }
    case 'message_end': {
      const message = event.message as
        | {
            role?: unknown
            content?: unknown
            model?: unknown
            provider?: unknown
            stopReason?: unknown
          }
        | undefined
      if (!message || message.role !== 'assistant') return null
      const blocks = Array.isArray(message.content) ? (message.content as never[]) : []
      return {
        type: 'message.completed',
        provenance: provenance(),
        role: 'assistant',
        content: { blocks },
        model: {
          provider: typeof message.provider === 'string' ? message.provider : undefined,
          modelId: typeof message.model === 'string' ? message.model : undefined
        },
        stopReason: typeof message.stopReason === 'string' ? message.stopReason : undefined
      }
    }
    case 'tool_execution_start':
      return {
        type: 'tool.started',
        provenance: provenance(),
        toolCall: {
          toolCallId: String(event.toolCallId),
          toolName: String(event.toolName),
          input: (event.args as Record<string, unknown>) ?? {}
        }
      }
    case 'tool_execution_end': {
      const isError = event.isError === true
      const result = {
        toolCallId: String(event.toolCallId),
        toolName: typeof event.toolName === 'string' ? event.toolName : undefined,
        isError,
        content: undefined
      }
      return {
        type: isError ? 'tool.failed' : 'tool.completed',
        provenance: provenance(),
        result
      }
    }
    default:
      return null
  }
}
