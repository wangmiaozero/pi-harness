/**
 * UniversalRuntimeService — the multi-runtime facade.
 *
 * Routes composite session ids (`<runtimeId>:<nativeId>`, bare ids stay Pi)
 * to the right adapter, forwards adapter RuntimeEvents to the renderer, and
 * keeps the multi-runtime session index used by the session center. Existing
 * Pi flows are untouched: this service only adds the universal surface.
 */

import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { IPC_EVENT } from '@shared/ipc/channels'
import { log } from '../services/logger'
import type {
  RuntimeEvent,
  RuntimeEventListener,
  RuntimePromptMessage,
  UniversalRuntimeDescriptor,
  UniversalSessionListItem,
  UniversalSessionRecord
} from '@shared/universal-runtime'
import { parseCompositeSessionId, toCompositeSessionId } from '@shared/universal-runtime'
import type { UniversalRuntimeRegistry } from './registry'

export type {
  UniversalRuntimeDescriptor,
  UniversalSessionListItem,
  UniversalSessionRecord
}

type WindowProvider = () => BrowserWindow | null

export class UniversalRuntimeService {
  private liveSessions = new Map<string, UniversalSessionRecord>()
  private eventSubscriptions = new Map<string, () => void>()

  constructor(
    private readonly registry: UniversalRuntimeRegistry,
    private readonly getWindow: WindowProvider
  ) {
    this.registry.setEvents({
      onRuntimeChanged: () => this.broadcastRuntimes()
    })
  }

  // -- descriptor surface -------------------------------------------------

  listRuntimes(): UniversalRuntimeDescriptor[] {
    return this.registry.list()
  }

  async healthCheckAll(): Promise<UniversalRuntimeDescriptor[]> {
    await this.registry.refreshHealthAll()
    return this.registry.list()
  }

  async setEnabled(runtimeId: string, enabled: boolean): Promise<UniversalRuntimeDescriptor[]> {
    if (!enabled) await this.evictRuntimeSessions(runtimeId)
    this.registry.setEnabled(runtimeId, enabled)
    return this.registry.list()
  }

  private async evictRuntimeSessions(runtimeId: string): Promise<void> {
    for (const [compositeId, record] of [...this.liveSessions]) {
      if (record.runtimeId !== runtimeId) continue
      this.eventSubscriptions.get(compositeId)?.()
      this.eventSubscriptions.delete(compositeId)
      this.liveSessions.delete(compositeId)
      this.broadcastEvent({
        type: 'session.completed',
        provenance: {
          runtimeId,
          nativeSessionId: record.nativeSessionId,
          sequence: 0,
          timestamp: Date.now()
        },
        cwd: record.cwd,
        model: record.model
      })
    }
  }

  // -- session surface ----------------------------------------------------

  async createSession(input: {
    runtimeId: string
    cwd: string
    message?: string
    model?: { provider?: string; modelId?: string } | null
    resumeSessionId?: string
  }): Promise<UniversalSessionRecord> {
    const message: RuntimePromptMessage | undefined = input.message
      ? { text: input.message }
      : undefined
    const runtimeId = input.runtimeId
    const handle = input.resumeSessionId
      ? await this.resumeOrCreate(runtimeId, input)
      : await this.registry.createSession(runtimeId, {
          cwd: input.cwd,
          ...(message ? { message } : {}),
          ...(input.model ? { model: input.model } : {})
        })
    return this.trackSession(runtimeId, handle, {
      cwd: input.cwd,
      model: input.model ?? handle.model ?? null,
      resumed: Boolean(input.resumeSessionId)
    })
  }

  private async resumeOrCreate(
    runtimeId: string,
    input: { cwd: string; resumeSessionId: string; model?: { provider?: string; modelId?: string } | null }
  ) {
    const adapter = await this.registry.ensureInitialized(runtimeId)
    if (!adapter.resumeSession) throw new Error(`Runtime does not support resume: ${runtimeId}`)
    return adapter.resumeSession(input.resumeSessionId, { cwd: input.cwd })
  }

  private trackSession(
    runtimeId: string,
    handle: { sessionId: string; cwd: string; model?: { provider?: string; modelId?: string } | null },
    meta: { cwd: string; model: { provider?: string; modelId?: string } | null; resumed: boolean }
  ): UniversalSessionRecord {
    const compositeId = toCompositeSessionId(runtimeId, handle.sessionId)
    const now = Date.now()
    const record: UniversalSessionRecord = {
      compositeId,
      runtimeId,
      nativeSessionId: handle.sessionId,
      cwd: handle.cwd || meta.cwd,
      model: meta.model,
      createdAt: now,
      updatedAt: now,
      running: false,
      resumed: meta.resumed
    }
    this.liveSessions.set(compositeId, record)
    this.watchEvents(runtimeId, handle.sessionId, compositeId)
    this.broadcastRuntimes()
    return record
  }

  private watchEvents(runtimeId: string, nativeSessionId: string, compositeId: string): void {
    const previous = this.eventSubscriptions.get(compositeId)
    previous?.()
    const listener: RuntimeEventListener = (event) => {
      const record = this.liveSessions.get(compositeId)
      if (record) {
        record.updatedAt = event.provenance.timestamp
        if ('model' in event && event.model !== undefined) record.model = event.model
        if (event.type === 'agent.started') record.running = true
        if (
          event.type === 'agent.completed' ||
          event.type === 'agent.failed' ||
          event.type === 'execution.cancelled'
        ) {
          record.running = false
        }
      }
      this.broadcastEvent(event)
    }
    const unsubscribe = this.registry.subscribe(runtimeId, nativeSessionId, listener)
    this.eventSubscriptions.set(compositeId, unsubscribe)
  }

  async prompt(compositeId: string, message: string): Promise<{ executionId: string }> {
    const { runtimeId, nativeSessionId } = parseCompositeSessionId(compositeId)
    const execution = await this.registry.sendMessage(runtimeId, nativeSessionId, {
      text: message
    })
    const record = this.liveSessions.get(compositeId)
    if (record) record.running = true
    return { executionId: execution.executionId }
  }

  async cancel(compositeId: string): Promise<void> {
    const { runtimeId, nativeSessionId } = parseCompositeSessionId(compositeId)
    await this.registry.cancel(runtimeId, nativeSessionId)
    const record = this.liveSessions.get(compositeId)
    if (record) record.running = false
  }

  async closeSession(compositeId: string): Promise<void> {
    const { runtimeId, nativeSessionId } = parseCompositeSessionId(compositeId)
    const record = this.liveSessions.get(compositeId)
    try {
      await this.registry.closeSession(runtimeId, nativeSessionId)
    } finally {
      this.eventSubscriptions.get(compositeId)?.()
      this.eventSubscriptions.delete(compositeId)
      if (record) this.liveSessions.delete(compositeId)
      this.broadcastRuntimes()
    }
  }

  async respondToPermission(requestId: string, outcome: string): Promise<void> {
    // Request ids are runtime-scoped; every enabled adapter ignores ids it
    // does not own. No dangerous silent-approval path exists.
    for (const descriptor of this.registry.list()) {
      if (!descriptor.enabled) continue
      const adapter = this.registry.get(descriptor.id)
      if (adapter?.respondToPermission) {
        await adapter.respondToPermission(requestId, outcome).catch((error) => {
          log.universal.warn(`permission response failed for ${descriptor.id}`, error)
        })
      }
    }
  }

  /**
   * Multi-runtime session list for the session center: live sessions of this
   * app run first, then each enabled runtime's persisted native sessions
   * (Pi sessions keep flowing through the existing session center).
   */
  async listSessions(
    filter?: { runtimeId?: string }
  ): Promise<UniversalSessionListItem[]> {
    const items: UniversalSessionListItem[] = []
    for (const record of this.liveSessions.values()) {
      if (filter?.runtimeId && record.runtimeId !== filter.runtimeId) continue
      items.push({
        compositeId: record.compositeId,
        runtimeId: record.runtimeId,
        nativeSessionId: record.nativeSessionId,
        cwd: record.cwd,
        model: record.model,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        running: record.running,
        live: true
      })
    }
    for (const descriptor of this.registry.list()) {
      if (!descriptor.enabled) continue
      if (filter?.runtimeId && descriptor.id !== filter.runtimeId) continue
      if (descriptor.id === 'pi') continue // native Pi sessions stay in the Pi session center
      const adapter = this.registry.get(descriptor.id)
      if (!adapter?.listSessions) continue
      const persisted = await adapter
        .listSessions()
        .catch((error) => {
          log.universal.warn(`session list failed for ${descriptor.id}`, error)
          return []
        })
      for (const session of persisted) {
        if (this.liveSessions.has(toCompositeSessionId(descriptor.id, session.sessionId))) continue
        items.push({
          compositeId: toCompositeSessionId(descriptor.id, session.sessionId),
          runtimeId: descriptor.id,
          nativeSessionId: session.sessionId,
          cwd: session.cwd,
          title: session.title,
          model: session.model,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          live: false
        })
      }
    }
    return items
  }

  // -- shutdown -------------------------------------------------------------

  async shutdown(): Promise<void> {
    for (const unsubscribe of this.eventSubscriptions.values()) unsubscribe()
    this.eventSubscriptions.clear()
    this.liveSessions.clear()
    await this.registry.disposeAll()
  }

  // -- renderer bridge -------------------------------------------------------

  private broadcastEvent(event: RuntimeEvent): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    try {
      win.webContents.send(IPC_EVENT.universalRuntimeEvent, event)
    } catch (error) {
      log.universal.error('failed to send runtime event:', error)
    }
  }

  private broadcastRuntimes(): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    try {
      win.webContents.send(IPC_EVENT.universalRuntimesChanged, {
        at: Date.now(),
        runtimes: this.registry.list()
      })
    } catch (error) {
      log.universal.error('failed to send runtime list:', error)
    }
  }

  /** Stable request id for renderer-side permission correlation. */
  static newRequestId(): string {
    return randomUUID()
  }
}
