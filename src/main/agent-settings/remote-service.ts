import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { z } from 'zod'
import type {
  RemoteHost,
  RemoteMessage,
  RemoteConversation,
  RemoteProject,
  RemoteSession
} from '@shared/agent-settings/schema'
import {
  remotePairSchema,
  remoteApprovalSchema,
  remoteApprovalResponseSchema
} from '@shared/agent-settings/schema'
import { APP_VERSION } from '@shared/constants'
import type { JsonStore } from '../services/storage'
import { ConfigError } from '../services/errors'
import { secretStore } from '../security/secret-store'
import { RemoteRpc, openSocket } from './socket'

const initializeResult = z.object({
  protocolVersion: z.literal('1.0'),
  server: z.object({ hostId: z.string().min(1).max(256), version: z.string().max(100) })
})
const hostRecord = z.object({
  id: z.string().uuid(),
  label: z.string().max(100),
  url: remotePairSchema.shape.url,
  hostId: z.string().min(1).max(256),
  version: z.string().max(100),
  lastConnectedAt: z.string().nullable()
})
const session = z.object({
  id: z.string().min(1).max(256),
  title: z.string().max(4096),
  workspaceLabel: z.string().max(4096).optional()
})
type HostRecord = z.infer<typeof hostRecord>
export interface RemoteState {
  hosts: HostRecord[]
}

export class RemoteHostService {
  private clients = new Map<string, RemoteRpc>()
  private connecting = new Map<string, Promise<RemoteHost>>()
  private generation = new Map<string, number>()
  private disposed = false
  private writes: Promise<unknown> = Promise.resolve()
  private async updateRecords(mutate: (records: HostRecord[]) => HostRecord[]): Promise<void> {
    const work = this.writes
      .catch(() => undefined)
      .then(async () => {
        await this.store.write({ hosts: mutate(await this.records()) })
      })
    this.writes = work
    await work
  }
  constructor(private store: JsonStore<RemoteState>) {}
  private async records(): Promise<HostRecord[]> {
    return z
      .array(hostRecord)
      .max(100)
      .parse((await this.store.read()).hosts)
  }
  private summary(host: HostRecord): RemoteHost {
    return {
      ...host,
      status:
        this.clients.get(host.id)?.socket.readyState === WebSocket.OPEN
          ? 'connected'
          : 'disconnected'
    }
  }
  async list(): Promise<RemoteHost[]> {
    return (await this.records()).map((h) => this.summary(h))
  }
  private async initialize(
    url: string,
    token: string
  ): Promise<{ client: RemoteRpc; hostId: string; version: string }> {
    const client = new RemoteRpc(await openSocket(url, { Authorization: `Bearer ${token}` }))
    try {
      const result = initializeResult.parse(
        await client.request('connection/initialize', {
          protocolVersion: '1.0',
          client: { name: 'Pi-Harness', version: APP_VERSION },
          bindings: ['RACP-WS'],
          capabilities: {
            history: true,
            eventReplay: false,
            approvals: true,
            inputRequests: false,
            turnQueue: false,
            hostEvents: false,
            terminal: false
          }
        })
      )
      client.notify('notifications/initialized')
      return { client, hostId: result.server.hostId, version: result.server.version }
    } catch {
      client.close()
      throw new ConfigError(
        'Remote host handshake failed. Check pi-host compatibility and the pairing token.'
      )
    }
  }
  async pair(input: z.infer<typeof remotePairSchema>): Promise<RemoteHost> {
    if (this.disposed) throw new ConfigError('Remote service is shutting down.')
    const existing = await this.records()
    if (existing.some((h) => h.url === input.url))
      throw new ConfigError('This host has already been added.')
    if (existing.length >= 100) throw new ConfigError('Remove a host before adding another.')
    const result = await this.initialize(input.url, input.token)
    let token = input.token
    const id = randomUUID()
    try {
      if (token.startsWith('ppt1.')) {
        const paired = z
          .object({ deviceToken: z.string().regex(/^pdt1\.[A-Za-z0-9_.-]+$/) })
          .parse(await result.client.request('connection/pair', { deviceLabel: input.label }))
        token = paired.deviceToken
      }
      if (this.disposed) throw new ConfigError('Remote service is shutting down.')
      await secretStore.setSecret(`remote-${id}`, token, { strict: true })
      const host: HostRecord = {
        id,
        label: input.label,
        url: input.url,
        hostId: result.hostId,
        version: result.version,
        lastConnectedAt: null
      }
      const current = await this.records()
      if (current.some((h) => h.url === input.url))
        throw new ConfigError('This host has already been added.')
      await this.updateRecords((records) => {
        if (records.some((item) => item.url === host.url))
          throw new ConfigError('This host has already been added.')
        return [...records, host]
      })
      return this.summary(host)
    } catch (error) {
      await secretStore.removeSecret(`remote-${id}`, { strict: true }).catch(() => undefined)
      throw error instanceof ConfigError
        ? error
        : new ConfigError('Pairing failed. Check the token and secure credential storage.')
    } finally {
      result.client.close()
    }
  }
  async connect(id: string): Promise<RemoteHost> {
    const pending = this.connecting.get(id)
    if (pending) return pending
    const generation = this.generation.get(id) ?? 0
    const work = this.connectOnce(id, generation)
    this.connecting.set(id, work)
    try {
      return await work
    } finally {
      if (this.connecting.get(id) === work) this.connecting.delete(id)
    }
  }
  private async connectOnce(id: string, generation: number): Promise<RemoteHost> {
    const host = (await this.records()).find((h) => h.id === id)
    if (!host || this.disposed) throw new ConfigError('Remote host is unavailable.')
    this.clients.get(id)?.close()
    this.clients.delete(id)
    const token = await secretStore.getSecret(`remote-${id}`, { strict: true })
    if (!token) throw new ConfigError('Pair this host again to restore its credential.')
    const result = await this.initialize(host.url, token)
    if (
      result.hostId !== host.hostId ||
      generation !== (this.generation.get(id) ?? 0) ||
      this.disposed
    ) {
      result.client.close()
      throw new ConfigError(
        'Host identity changed or the connection was cancelled. Pair the intended host again.'
      )
    }
    this.clients.set(id, result.client)
    const updated = { ...host, version: result.version, lastConnectedAt: new Date().toISOString() }
    await this.updateRecords((records) => records.map((h) => (h.id === id ? updated : h)))
    return this.summary(updated)
  }
  disconnect(id: string): void {
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1)
    this.clients.get(id)?.close()
    this.clients.delete(id)
  }
  async remove(id: string): Promise<void> {
    this.disconnect(id)
    await secretStore.removeSecret(`remote-${id}`, { strict: true })
    await this.updateRecords((records) => records.filter((h) => h.id !== id))
  }
  private client(id: string): RemoteRpc {
    const client = this.clients.get(id)
    if (!client || client.socket.readyState !== WebSocket.OPEN)
      throw new ConfigError('Connect to the remote host first.')
    return client
  }
  async projects(id: string): Promise<RemoteProject[]> {
    const result = z
      .object({
        projects: z
          .array(
            z.object({
              id: z.string().max(256),
              label: z.string().max(4096),
              path: z.string().max(4096).optional()
            })
          )
          .max(1000)
      })
      .parse(await this.client(id).request('project/list'))
    return result.projects.map((p) => ({ id: p.id, name: p.label, path: p.path ?? '' }))
  }
  async sessions(id: string): Promise<RemoteSession[]> {
    return z
      .object({ sessions: z.array(session).max(5000) })
      .parse(await this.client(id).request('session/list'))
      .sessions.map((s) => ({ id: s.id, title: s.title, cwd: s.workspaceLabel ?? '' }))
  }
  async history(id: string, sessionId: string): Promise<RemoteConversation> {
    const item = z.object({ id: z.string().max(256), itemType: z.string(), content: z.unknown() })
    const result = z
      .object({
        snapshot: z.object({
          items: z.array(item).max(2000),
          activeItems: z.array(item).max(100),
          pendingApprovals: z.array(remoteApprovalSchema).max(100)
        })
      })
      .parse(await this.client(id).request('session/attach', { sessionId, includeSnapshot: true }))
    const items = new Map(result.snapshot.items.map((item) => [item.id, item]))
    for (const item of result.snapshot.activeItems) items.set(item.id, item)
    const messages: RemoteMessage[] = [...items.values()].flatMap((item) => {
      const content = item.content as { content?: unknown; role?: unknown } | undefined
      if (content?.role === 'system' || typeof content?.content !== 'string') return []
      return [
        {
          role: typeof content.role === 'string' ? content.role : item.itemType,
          text: content.content.slice(0, 100000)
        }
      ]
    })
    return {
      messages,
      approvals: result.snapshot.pendingApprovals.filter(
        (item) => item.sessionId === sessionId && Date.parse(item.expiresAt) > Date.now()
      )
    }
  }
  async approve(input: z.infer<typeof remoteApprovalResponseSchema>): Promise<void> {
    const conversation = await this.history(input.id, input.sessionId)
    const pending = conversation.approvals.find((item) => item.id === input.approvalId)
    if (
      !pending ||
      !pending.allowedDecisions.includes(input.decision) ||
      (input.permissionMode && !pending.allowedPermissionModes?.includes(input.permissionMode))
    )
      throw new ConfigError('This approval changed or expired. Refresh the conversation.')
    if (pending.kind !== 'tool' && input.decision === 'approve' && !input.permissionMode)
      throw new ConfigError('Choose a permission mode before approving.')
    await this.client(input.id).request('approval/respond', {
      approvalId: input.approvalId,
      decision: input.decision,
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      context: { requestId: randomUUID(), expectedRevision: pending.revision }
    })
  }
  async create(id: string, projectId: string): Promise<RemoteSession> {
    if (!(await this.projects(id)).some((p) => p.id === projectId))
      throw new ConfigError('Select a project offered by this host.')
    const result = z
      .object({ session })
      .parse(await this.client(id).request('session/create', { projectId }))
    return {
      id: result.session.id,
      title: result.session.title,
      cwd: result.session.workspaceLabel ?? ''
    }
  }
  async prompt(id: string, sessionId: string, text: string): Promise<void> {
    await this.client(id).request('turn/start', {
      sessionId,
      idempotencyKey: randomUUID(),
      input: { text },
      context: { requestId: randomUUID() }
    })
  }
  async stop(id: string, sessionId: string): Promise<void> {
    const result = z
      .object({ session: z.object({ activeTurnId: z.string().optional() }) })
      .parse(await this.client(id).request('session/get', { sessionId }))
    if (result.session.activeTurnId)
      await this.client(id).request('turn/stop', { turnId: result.session.activeTurnId })
  }
  dispose(): void {
    this.disposed = true
    for (const client of this.clients.values()) client.close()
    this.clients.clear()
  }
}
