/**
 * Universal Runtime Registry — the kernel's runtime registration center.
 *
 * Responsibilities: adapter registration/removal, capability discovery,
 * enable/disable state (persisted), health checks, lifecycle, failure
 * isolation (one failing runtime never takes down others), and diagnostics
 * logging. The registry depends only on the shared adapter contract — never
 * on the Pi SDK.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { log } from '../services/logger'
import type { JsonStore } from '../services/storage'
import {
  assertCapability,
  CapabilityNotSupportedError,
  type AgentRuntimeAdapter,
  type RuntimeCapabilities,
  type RuntimeContext,
  type RuntimeHealth,
  type RuntimeSessionHandle,
  type CreateSessionOptions,
  type RuntimeExecution,
  type RuntimeEventListener,
  type RuntimeSessionSummary,
  type RuntimePromptMessage,
  type UniversalRuntimeDescriptor
} from '@shared/universal-runtime'

export type { UniversalRuntimeDescriptor }

export interface RegistryEvents {
  onRuntimeChanged?: (runtimeId: string) => void
}

interface RegistryState {
  /** Runtime enablement persisted across restarts; missing = runtime default. */
  enabled: Record<string, boolean>
}

const STATE_DEFAULT: RegistryState = { enabled: {} }

export class UniversalRuntimeRegistry {
  private adapters = new Map<string, AgentRuntimeAdapter>()
  private initialized = new Set<string>()
  private initFailures = new Map<string, string>()
  private healthCache = new Map<string, RuntimeHealth>()
  private state: RegistryState = structuredClone(STATE_DEFAULT)
  private events: RegistryEvents = {}
  private disposed = false

  constructor(
    private readonly options: {
      /** userData root; each runtime gets an isolated dataDir below it. */
      dataRoot: string
      store?: JsonStore<RegistryState>
    }
  ) {
    if (options.store) {
      this.state = { ...structuredClone(STATE_DEFAULT), ...(options.store.peek() ?? {}) }
    }
  }

  setEvents(events: RegistryEvents): void {
    this.events = events
  }

  private notify(runtimeId: string): void {
    try {
      this.events.onRuntimeChanged?.(runtimeId)
    } catch (error) {
      log.universal?.warn?.('runtime change notify failed', error)
    }
  }

  register(adapter: AgentRuntimeAdapter, options?: { builtin?: boolean }): void {
    if (this.disposed) throw new Error('Registry is disposed')
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Runtime already registered: ${adapter.id}`)
    }
    this.adapters.set(adapter.id, adapter)
    this.markBuiltin(adapter.id, options?.builtin ?? false)
    log.universal?.info?.(`registered runtime: ${adapter.id} (${adapter.name})`)
    this.notify(adapter.id)
  }

  unregister(runtimeId: string): void {
    const adapter = this.adapters.get(runtimeId)
    if (!adapter) return
    void adapter
      .dispose()
      .catch((error) => log.universal?.error?.(`dispose failed for ${runtimeId}`, error))
    this.adapters.delete(runtimeId)
    this.initialized.delete(runtimeId)
    this.markBuiltin(runtimeId, false)
    this.notify(runtimeId)
  }

  get(runtimeId: string): AgentRuntimeAdapter | undefined {
    return this.adapters.get(runtimeId)
  }

  /** Resolve an adapter the caller may actually use. */
  resolve(runtimeId: string): AgentRuntimeAdapter {
    const adapter = this.adapters.get(runtimeId)
    if (!adapter) throw new Error(`Unknown runtime: ${runtimeId}`)
    if (!this.isEnabled(runtimeId)) throw new Error(`Runtime is disabled: ${runtimeId}`)
    return adapter
  }

  list(): UniversalRuntimeDescriptor[] {
    return [...this.adapters.values()].map((adapter) => this.describe(adapter.id))
  }

  describe(runtimeId: string): UniversalRuntimeDescriptor {
    const adapter = this.adapters.get(runtimeId)
    if (!adapter) throw new Error(`Unknown runtime: ${runtimeId}`)
    return {
      id: adapter.id,
      name: adapter.name,
      description: adapter.description,
      enabled: this.isEnabled(runtimeId),
      builtin: this.isBuiltin(runtimeId),
      capabilities: adapter.getCapabilities(),
      health: this.healthCache.get(runtimeId) ?? null,
      initialized: this.initialized.has(runtimeId)
    }
  }

  isEnabled(runtimeId: string): boolean {
    const override = this.state.enabled[runtimeId]
    if (typeof override === 'boolean') return override
    return this.defaultEnabled(runtimeId)
  }

  /** Enablement changes do not take effect for already-initialized runtimes. */
  setEnabled(runtimeId: string, enabled: boolean): void {
    if (!this.adapters.has(runtimeId)) throw new Error(`Unknown runtime: ${runtimeId}`)
    if (runtimeId === 'pi' && !enabled) {
      throw new Error('The default Pi runtime cannot be disabled')
    }
    this.state.enabled[runtimeId] = enabled
    this.options.store?.update({ enabled: this.state.enabled }).catch(() => {})
    log.universal?.info?.(`${enabled ? 'enabled' : 'disabled'} runtime: ${runtimeId}`)
    if (!enabled) {
      const adapter = this.adapters.get(runtimeId)
      void adapter
        ?.dispose()
        .catch((error) => log.universal?.warn?.(`disable dispose failed: ${runtimeId}`, error))
      this.initialized.delete(runtimeId)
    }
    this.notify(runtimeId)
  }

  capabilities(runtimeId: string): RuntimeCapabilities {
    return this.adapters.get(runtimeId)?.getCapabilities() ?? { supported: [] }
  }

  private dataDirFor(runtimeId: string): string {
    const dir = path.join(this.options.dataRoot, 'runtimes', runtimeId)
    void fs.mkdir(dir, { recursive: true }).catch(() => {})
    return dir
  }

  /**
   * Lazily initialize an adapter on first use. Initialization failures are
   * isolated: the error is recorded and surfaced via health, other runtimes
   * keep working.
   */
  async ensureInitialized(runtimeId: string): Promise<AgentRuntimeAdapter> {
    const adapter = this.resolve(runtimeId)
    if (this.initialized.has(runtimeId)) return adapter
    if (this.initFailures.has(runtimeId)) {
      throw new Error(this.initFailures.get(runtimeId)!)
    }
    const context: RuntimeContext = {
      dataDir: this.dataDirFor(runtimeId),
      log: {
        info: (message, ...args) => log.universal?.info?.(`[${runtimeId}] ${message}`, ...args),
        warn: (message, ...args) => log.universal?.warn?.(`[${runtimeId}] ${message}`, ...args),
        error: (message, ...args) => log.universal?.error?.(`[${runtimeId}] ${message}`, ...args)
      }
    }
    try {
      await adapter.initialize(context)
      this.initialized.add(runtimeId)
      log.universal?.info?.(`initialized runtime: ${runtimeId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.initFailures.set(runtimeId, message)
      log.universal?.error?.(`initialize failed for ${runtimeId}:`, error)
      throw error
    }
    return adapter
  }

  /** Best-effort cached health; `refresh` probes the engine again. */
  async health(runtimeId: string, refresh = false): Promise<RuntimeHealth> {
    const adapter = this.adapters.get(runtimeId)
    if (!adapter) throw new Error(`Unknown runtime: ${runtimeId}`)
    if (!refresh) {
      const cached = this.healthCache.get(runtimeId)
      if (cached) return cached
    }
    let health: RuntimeHealth
    try {
      health = await adapter.healthCheck()
    } catch (error) {
      health = {
        status: 'error',
        installState: 'unknown',
        version: null,
        message: error instanceof Error ? error.message : String(error),
        checkedAt: Date.now()
      }
    }
    this.healthCache.set(runtimeId, health)
    this.notify(runtimeId)
    return health
  }

  async refreshHealthAll(): Promise<void> {
    await Promise.allSettled(
      [...this.adapters.keys()].map((id) => this.health(id, true))
    )
  }

  /** Dispatch helpers below enforce capability checks in the backend. */

  async createSession(
    runtimeId: string,
    options: CreateSessionOptions
  ): Promise<RuntimeSessionHandle> {
    const adapter = await this.ensureInitialized(runtimeId)
    assertCapability(runtimeId, adapter.getCapabilities(), 'session.create')
    return adapter.createSession(options)
  }

  async sendMessage(
    runtimeId: string,
    sessionId: string,
    message: RuntimePromptMessage
  ): Promise<RuntimeExecution> {
    const adapter = await this.ensureInitialized(runtimeId)
    assertCapability(runtimeId, adapter.getCapabilities(), 'prompt.send')
    return adapter.sendMessage(sessionId, message)
  }

  async cancel(runtimeId: string, sessionId: string): Promise<void> {
    const adapter = await this.ensureInitialized(runtimeId)
    assertCapability(runtimeId, adapter.getCapabilities(), 'prompt.cancel')
    if (!adapter.cancel) {
      throw new CapabilityNotSupportedError(runtimeId, 'prompt.cancel')
    }
    return adapter.cancel(sessionId)
  }

  async listSessions(runtimeId: string): Promise<RuntimeSessionSummary[]> {
    const adapter = await this.ensureInitialized(runtimeId)
    assertCapability(runtimeId, adapter.getCapabilities(), 'session.list')
    if (!adapter.listSessions) {
      throw new CapabilityNotSupportedError(runtimeId, 'session.list')
    }
    return adapter.listSessions()
  }

  async closeSession(runtimeId: string, sessionId: string): Promise<void> {
    const adapter = await this.ensureInitialized(runtimeId)
    assertCapability(runtimeId, adapter.getCapabilities(), 'session.close')
    if (!adapter.closeSession) {
      throw new CapabilityNotSupportedError(runtimeId, 'session.close')
    }
    return adapter.closeSession(sessionId)
  }

  subscribe(
    runtimeId: string,
    sessionId: string,
    listener: RuntimeEventListener
  ): () => void {
    const adapter = this.adapters.get(runtimeId)
    if (!adapter) return () => {}
    return adapter.subscribe(sessionId, listener)
  }

  async disposeAll(): Promise<void> {
    this.disposed = true
    const stopping = [...this.adapters.values()].map(async (adapter) => {
      try {
        await adapter.dispose()
      } catch (error) {
        log.universal?.warn?.(`dispose failed for ${adapter.id}`, error)
      }
    })
    await Promise.allSettled(stopping)
    this.initialized.clear()
  }

  // -- persisted metadata ----------------------------------------------

  private builtinIds = new Set<string>()

  private markBuiltin(runtimeId: string, builtin: boolean): void {
    if (builtin) this.builtinIds.add(runtimeId)
    else this.builtinIds.delete(runtimeId)
  }

  private isBuiltin(runtimeId: string): boolean {
    return this.builtinIds.has(runtimeId)
  }

  private defaultEnabled(runtimeId: string): boolean {
    // Only the default engine (pi) ships enabled; optional runtimes require
    // explicit user opt-in so a fresh install behaves exactly like before.
    return runtimeId === 'pi'
  }
}
