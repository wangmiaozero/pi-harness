/**
 * MockRuntimeAdapter — a fully in-process reference runtime.
 *
 * Ships as the canonical SDK example for third-party runtime authors and the
 * test double for the kernel: registry behavior, capability negotiation,
 * composite session ids and event fan-out can all be verified without any
 * engine installed. It implements every optional surface it declares, so its
 * capability list stays truthful.
 */

import { randomUUID } from 'node:crypto'
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

export const MOCK_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  supported: [
    'session.create',
    'session.list',
    'session.resume',
    'session.close',
    'prompt.send',
    'prompt.cancel',
    'streaming'
  ]
}

interface MockSession {
  handle: RuntimeSessionHandle
  listeners: Set<RuntimeEventListener>
  running: boolean
  cancelled: boolean
}

export class MockRuntimeAdapter implements AgentRuntimeAdapter {
  readonly id = 'mock'
  readonly name = 'Mock Runtime'
  readonly description = 'In-process reference runtime for tests and SDK examples'

  private sessions = new Map<string, MockSession>()
  private context: RuntimeContext | null = null
  private disposed = false
  private nextSequence = 0

  getCapabilities(): RuntimeCapabilities {
    return MOCK_RUNTIME_CAPABILITIES
  }

  async initialize(context: RuntimeContext): Promise<void> {
    this.context = context
  }

  async healthCheck(): Promise<RuntimeHealth> {
    return {
      status: this.disposed ? 'error' : 'ok',
      installState: 'installed',
      version: '1.0.0-mock',
      message: null,
      checkedAt: Date.now()
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const session of this.sessions.values()) {
      this.emit(session, { type: 'runtime.stopped', provenance: this.prov(session) })
    }
    this.sessions.clear()
  }

  async createSession(options: CreateSessionOptions): Promise<RuntimeSessionHandle> {
    const handle: RuntimeSessionHandle = {
      sessionId: `mock-${randomUUID()}`,
      cwd: options.cwd,
      reference: `${this.id}:${options.cwd}`
    }
    const session: MockSession = { handle, listeners: new Set(), running: false, cancelled: false }
    this.sessions.set(handle.sessionId, session)
    this.emit(session, {
      type: 'session.created',
      provenance: this.prov(session),
      cwd: options.cwd,
      model: null
    })
    if (options.message?.text) await this.deliverReply(session, options.message)
    return handle
  }

  async resumeSession(sessionId: string): Promise<RuntimeSessionHandle> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Mock session not found: ${sessionId}`)
    return session.handle
  }

  async sendMessage(sessionId: string, message: RuntimePromptMessage): Promise<RuntimeExecution> {
    const session = this.require(sessionId)
    const executionId = `mock-exec-${randomUUID()}`
    await this.deliverReply(session, message, executionId)
    return { executionId }
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    if (session.running) {
      session.cancelled = true
      this.emit(session, { type: 'execution.cancelled', provenance: this.prov(session) })
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.emit(session, { type: 'session.completed', provenance: this.prov(session) })
    this.sessions.delete(sessionId)
  }

  async listSessions(): Promise<RuntimeSessionSummary[]> {
    return [...this.sessions.values()].map((session) => ({
      sessionId: session.handle.sessionId,
      createdAt: null,
      updatedAt: null,
      cwd: session.handle.cwd,
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

  private async deliverReply(
    session: MockSession,
    message: RuntimePromptMessage,
    executionId?: string
  ): Promise<void> {
    if (session.cancelled) return
    session.running = true
    const prov = (executionId?: string) => ({ ...this.prov(session), ...(executionId ? { executionId } : {}) })
    this.emit(session, { type: 'agent.started', provenance: prov(executionId) })
    this.emit(session, { type: 'message.started', provenance: prov(executionId), role: 'assistant' })
    const reply = `Mock reply to: ${message.text}`
    for (const chunk of reply.match(/.{1,8}/gs) ?? []) {
      if (session.cancelled) break
      this.emit(session, { type: 'message.delta', provenance: prov(executionId), delta: { delta: chunk } })
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    if (session.cancelled) {
      session.running = false
      return
    }
    this.emit(session, {
      type: 'message.completed',
      provenance: prov(executionId),
      role: 'assistant',
      content: { text: reply },
      model: { provider: 'mock', modelId: 'mock-1' }
    })
    session.running = false
    this.emit(session, { type: 'agent.completed', provenance: prov(executionId) })
  }

  private require(sessionId: string): MockSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Mock session not found: ${sessionId}`)
    return session
  }

  private prov(session: MockSession) {
    return {
      runtimeId: this.id,
      nativeSessionId: session.handle.sessionId,
      sequence: ++this.nextSequence,
      timestamp: Date.now()
    }
  }

  private emit(session: MockSession, event: RuntimeEvent): void {
    for (const listener of session.listeners) {
      try {
        listener(event)
      } catch {
        /* listener failures are isolated */
      }
    }
  }
}
