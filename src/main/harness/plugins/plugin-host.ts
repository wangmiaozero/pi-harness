import path from 'node:path'
import { z } from 'zod'
import type { HarnessRuntime } from '../harness-runtime'
import type { HarnessEventEnvelope, HarnessRun } from '@shared/types/harness'
import type {
  PluginDescriptor,
  PluginDiagnostic,
  PluginRecord,
  EvaluatorResult
} from '@shared/harness-plugins/types'
import type {
  AuthorizedTrace,
  PluginEvent,
  PluginPermission,
  TeamTemplate
} from '../../../../packages/harness-plugin-sdk'
import {
  compatible,
  evidenceSchema,
  evaluatorResultSchema,
  eventSchema,
  jsonSchema,
  traceSchema,
  PLUGIN_EVENT_TYPES
} from '@shared/harness-plugins/schema'
import { PluginRegistry, hasPermissions } from './plugin-registry'
import { boundedJson, PluginProcessHost, type PluginProcessFactory } from './process-host'
import { log, redactSecrets, redactSecretText } from '../../services/logger'
import { SecurityError, ValidationError } from '../../services/errors'
import type { OrchestratorService } from '../orchestrator/orchestrator-service'
import { JsonStore } from '../../services/storage'

type HarnessSource = Pick<HarnessRuntime, 'onEvent' | 'getRunById' | 'getRunDetail'>
interface ActivePlugin {
  record: PluginRecord
  process: PluginProcessHost | null
  queue: PluginEvent[]
  busy: boolean
  stopped: boolean
}
export interface PluginApproval {
  digest: string
  permissions: PluginPermission[]
  trustedCode: boolean
}
export interface PluginHostOptions {
  directory: string
  harness: HarnessSource
  processFactory: PluginProcessFactory
  approve: (record: PluginRecord) => Promise<PluginApproval | null>
  orchestrator?: OrchestratorService
  eventQueueLimit?: number
  timeoutMs?: number
}
interface ResultRow {
  pluginId: string
  runId: string
  result: EvaluatorResult
}

export class HarnessPluginHost {
  readonly registry: PluginRegistry
  private active = new Map<string, ActivePlugin>()
  private states = new Map<string, PluginDescriptor['status']>()
  private diagnostics = new Map<string, PluginDiagnostic[]>()
  private drops = new Map<string, number>()
  private results: ResultRow[] = []
  private resultStore: JsonStore<{ results: ResultRow[] }>
  private unsubscribe: (() => void) | null = null
  private operations: Promise<unknown> = Promise.resolve()
  private closed = false
  private ready = false
  constructor(private options: PluginHostOptions) {
    this.registry = new PluginRegistry(options.directory)
    this.resultStore = new JsonStore(path.join(options.directory, 'results.json'), { results: [] })
  }
  async initialize(): Promise<void> {
    await this.registry.initialize()
    await this.registry.assertMetadataFile('results.json')
    const stored = await this.resultStore.read()
    // Stored rows wrap each already-bounded result in additional object/array levels.
    boundedJson(stored, 2 * 1024 * 1024, 200000, 16)
    // Revalidate disk data instead of trusting JsonStore's generic parameter.
    const parsed = z
      .strictObject({
        results: z
          .array(
            z.strictObject({
              pluginId: z.string().max(100),
              runId: z.string().max(128),
              result: evaluatorResultSchema
            })
          )
          .max(200)
      })
      .safeParse(stored)
    this.results = parsed.success ? parsed.data.results : []
    this.ready = true
    for (const record of this.registry.list()) {
      this.states.set(record.manifest.id, compatible(record.manifest) ? 'disabled' : 'incompatible')
      if (record.enabled) {
        try {
          await this.activate(record.manifest.id, false)
        } catch {
          this.states.set(
            record.manifest.id,
            compatible(record.manifest) ? 'failed' : 'incompatible'
          )
          this.record(record.manifest.id, 'error', 'PLUGIN_RESTORE_FAILED')
          await this.registry.update(record.manifest.id, { enabled: false })
        }
      }
    }
  }
  list(): PluginDescriptor[] {
    if (!this.ready) throw new ValidationError('Plugin subsystem unavailable')
    return this.registry.list().map((record) => ({
      ...record,
      status:
        this.states.get(record.manifest.id) ??
        (compatible(record.manifest) ? 'installed' : 'incompatible'),
      compatible: compatible(record.manifest),
      diagnostics: structuredClone(this.diagnostics.get(record.manifest.id) ?? []),
      droppedEvents: this.drops.get(record.manifest.id) ?? 0,
      results: structuredClone(
        this.results
          .filter((r) => r.pluginId === record.manifest.id)
          .slice(-20)
          .map((r) => ({ runId: r.runId, result: r.result }))
      )
    }))
  }
  install(source: string): Promise<PluginDescriptor> {
    return this.serial(async () => {
      const record = await this.registry.install(source)
      this.states.set(
        record.manifest.id,
        compatible(record.manifest) ? 'installed' : 'incompatible'
      )
      return this.list().find((p) => p.manifest.id === record.manifest.id)!
    })
  }
  setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.serial(async () => {
      if (enabled) await this.activate(id, true)
      else {
        this.registry.get(id)
        await this.deactivate(id)
        await this.registry.update(id, { enabled: false })
        this.states.set(id, 'disabled')
      }
    })
  }
  uninstall(id: string): Promise<void> {
    return this.serial(async () => {
      this.registry.get(id)
      await this.deactivate(id)
      await this.registry.update(id, { enabled: false, grants: [], trustedDigest: null })
      await this.registry.uninstall(id)
      this.results = this.results.filter((r) => r.pluginId !== id)
      await this.saveResults()
      this.states.delete(id)
      this.diagnostics.delete(id)
      this.drops.delete(id)
    })
  }
  async evaluate(
    id: string,
    evaluatorId: string,
    sessionId: string,
    runId: string
  ): Promise<EvaluatorResult> {
    const live = this.requireActive(id, 'evaluation:read')
    const definition = this.registry
      .get(id)
      .manifest.contributions.evaluators.find((e) => e.id === evaluatorId)
    if (!definition || !live.process) throw new ValidationError('Evaluator not registered')
    const run = await this.run(sessionId, runId)
    if (['queued', 'running', 'waiting', 'tool-calling', 'verifying'].includes(run.status))
      throw new ValidationError('Run has not settled')
    const evidence = evidenceSchema.parse({
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      toolCallCount: run.toolCallCount,
      toolFailureCount: run.toolFailureCount,
      totalTokens: run.usage.totalTokens
    })
    try {
      const result = evaluatorResultSchema.parse(
        redactSecrets(
          await live.process.request('evaluate', { id: evaluatorId, evidence }, this.timeout)
        )
      )
      if (result.evaluatorId !== definition.id || result.version !== definition.version)
        throw new Error('PLUGIN_INVALID_RESULT')
      this.assertCurrent(id, live)
      this.results = [
        ...this.results.filter(
          (r) => !(r.pluginId === id && r.runId === runId && r.result.evaluatorId === evaluatorId)
        ),
        { pluginId: id, runId, result }
      ].slice(-200)
      await this.saveResults()
      return result
    } catch (e) {
      this.record(id, 'error', 'PLUGIN_EVALUATION_FAILED')
      throw e
    }
  }
  async exportTrace(
    id: string,
    exporterId: string,
    sessionId: string,
    runId: string
  ): Promise<unknown> {
    const live = this.requireActive(id, 'trace:read')
    if (
      !live.process ||
      !this.registry.get(id).manifest.contributions.exporters.some((e) => e.id === exporterId)
    )
      throw new ValidationError('Exporter not registered')
    await this.run(sessionId, runId)
    const detail = await this.options.harness.getRunDetail(sessionId, runId)
    if (!detail.trace) throw new ValidationError('No recorded trace for this run')
    const trace: AuthorizedTrace = traceSchema.parse({
      runId,
      source: detail.trace.source,
      spans: detail.trace.spans.slice(0, 2000).map((s) => ({
        id: s.id,
        type: s.type,
        status: s.status,
        startedAt: s.startedAt,
        duration: s.duration
      }))
    })
    const value = await live.process.request('export', { id: exporterId, trace }, this.timeout)
    boundedJson(value)
    const result = jsonSchema.parse(redactSecrets(value))
    this.assertCurrent(id, live)
    return result
  }
  async applyTeam(id: string, templateId: string, cwd: string): Promise<string> {
    return this.serial(async () => {
      const live = this.requireActive(id, 'teams:contribute'),
        orchestrator = this.options.orchestrator
      if (!orchestrator) throw new ValidationError('Orchestration unavailable')
      const record = this.registry.get(id),
        team = record.manifest.contributions.teams.find((t) => t.id === templateId)
      if (!team || !hasPermissions(record, team.permissions))
        throw new SecurityError('Template permission denied')
      this.assertCurrent(id, live)
      return this.materializeTeam(orchestrator, team, cwd)
    })
  }
  async close(): Promise<void> {
    this.closed = true
    await this.operations.catch(() => {})
    await Promise.all([...this.active.keys()].map((id) => this.deactivate(id)))
    this.unsubscribe?.()
    this.unsubscribe = null
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.operations.then(() => {
      if (this.closed || !this.ready) throw new Error('Plugin host unavailable')
      return work()
    })
    this.operations = result.catch(() => {})
    return result
  }
  private get timeout(): number {
    return this.options.timeoutMs ?? 2000
  }
  private async activate(id: string, ask: boolean): Promise<void> {
    if (this.active.has(id)) return
    if (this.active.size >= 8) throw new ValidationError('At most eight plugins can be active')
    let record = this.registry.get(id)
    if (!compatible(record.manifest)) {
      this.states.set(id, 'incompatible')
      throw new ValidationError('Harness Plugin API version is incompatible')
    }
    const entry = await this.registry.verify(id)
    if (
      !hasPermissions(record, record.manifest.permissions) ||
      (entry && record.trustedDigest !== record.digest)
    ) {
      const approval = ask ? await this.options.approve(record) : null
      if (
        !approval ||
        approval.digest !== record.digest ||
        !record.manifest.permissions.every((p) => approval.permissions.includes(p)) ||
        (entry && !approval.trustedCode)
      )
        throw new SecurityError('Plugin permission or code trust denied')
      await this.registry.update(id, {
        grants: [...record.manifest.permissions],
        trustedDigest: entry ? record.digest : null
      })
      record = this.registry.get(id)
    }
    // Verify again after the native approval dialog and before executing code.
    await this.registry.verify(id)
    const live: ActivePlugin = { record, process: null, queue: [], busy: false, stopped: false }
    this.active.set(id, live)
    this.states.set(id, 'activating')
    try {
      if (entry) {
        live.process = new PluginProcessHost(
          this.options.processFactory(entry),
          (code) => this.fault(id, live, code),
          (logs) => {
            if (this.active.get(id) === live && !live.stopped)
              for (const item of logs)
                this.record(
                  id,
                  'info',
                  'PLUGIN_LOG',
                  `${item.message} ${JSON.stringify(redactSecrets(item.metadata))}`
                )
          }
        )
        await live.process.activate(record.manifest)
      }
      this.assertCurrent(id, live)
      await this.registry.update(id, { enabled: true })
      this.states.set(id, 'active')
      this.syncBridge()
      this.record(id, 'info', 'PLUGIN_ACTIVATED')
    } catch (e) {
      this.fault(id, live, 'PLUGIN_ACTIVATION_FAILED')
      throw e
    }
  }
  private async deactivate(id: string): Promise<void> {
    const live = this.active.get(id)
    if (!live) return
    this.active.delete(id)
    live.stopped = true
    live.queue = []
    this.syncBridge()
    if (live.process) {
      try {
        await live.process.request('deactivate', null, Math.min(this.timeout, 500))
      } catch {
        /* teardown is best effort; termination is mandatory */
      } finally {
        live.process.stop()
      }
    }
  }
  private syncBridge(): void {
    const needs = [...this.active.keys()].some(
      (id) => this.active.get(id)!.record.manifest.contributions.events.length > 0
    )
    if (!needs) {
      this.unsubscribe?.()
      this.unsubscribe = null
    } else if (!this.unsubscribe)
      this.unsubscribe = this.options.harness.onEvent((payload) => this.enqueue(payload))
  }
  private enqueue(payload: HarnessEventEnvelope): void {
    // This callback only projects small scalar fields and queues work. It never calls plugin code.
    if (!PLUGIN_EVENT_TYPES.some((type) => type === payload.event.type)) return
    const event = this.projectEvent(payload)
    if (!event) return
    for (const [id, live] of this.active) {
      const record = live.record
      if (
        this.states.get(id) !== 'active' ||
        !record.grants.includes('events:read') ||
        !record.manifest.contributions.events.includes(event.event.type)
      )
        continue
      if (live.queue.length >= (this.options.eventQueueLimit ?? 64)) {
        this.drops.set(id, (this.drops.get(id) ?? 0) + 1)
        if (this.drops.get(id) === 1) this.record(id, 'warning', 'PLUGIN_EVENT_QUEUE_OVERFLOW')
        continue
      }
      live.queue.push(event)
      if (!live.busy) {
        live.busy = true
        setImmediate(() => {
          void this.drain(id, live)
        })
      }
    }
  }
  private projectEvent(payload: HarnessEventEnvelope): PluginEvent | null {
    const e = payload.event
    const projected = {
      type: e.type,
      timestamp: e.timestamp,
      ...('runId' in e ? { runId: e.runId } : {}),
      ...('status' in e ? { status: e.status } : {}),
      ...(e.type === 'tool.completed'
        ? { toolName: redactSecretText(e.toolName).slice(0, 128), isError: e.isError }
        : {})
    }
    const result = eventSchema.safeParse({ sessionId: payload.sessionId, event: projected })
    return result.success ? result.data : null
  }
  private async drain(id: string, live: ActivePlugin): Promise<void> {
    try {
      while (!live.stopped && live.queue.length) {
        const event = live.queue.shift()!
        if (live.process) {
          await live.process.request('event', event, this.timeout)
          this.assertCurrent(id, live)
        }
      }
    } catch {
      if (!live.stopped) this.fault(id, live, 'PLUGIN_EVENT_FAILED')
    } finally {
      live.busy = false
    }
  }
  private fault(id: string, live: ActivePlugin, code: string): void {
    if (this.active.get(id) !== live) return
    this.active.delete(id)
    live.stopped = true
    live.queue = []
    live.process?.stop()
    this.syncBridge()
    this.states.set(id, 'failed')
    this.record(id, 'error', code)
    // Serialize durable disable with lifecycle mutations; no rejected promise escapes into the runtime.
    void this.serial(() => this.registry.update(id, { enabled: false })).catch(() =>
      log.harness.warn('plugin disable persistence failed')
    )
  }
  private requireActive(id: string, permission: PluginPermission): ActivePlugin {
    const record = this.registry.get(id),
      live = this.active.get(id)
    if (!live || this.states.get(id) !== 'active' || !record.grants.includes(permission))
      throw new SecurityError('Plugin inactive or permission denied')
    return live
  }
  private assertCurrent(id: string, live: ActivePlugin): void {
    if (this.closed || live.stopped || this.active.get(id) !== live)
      throw new Error('PLUGIN_DISABLED')
  }
  private async run(sessionId: string, runId: string): Promise<HarnessRun> {
    const run = await this.options.harness.getRunById(runId)
    if (!run || run.sessionId !== sessionId)
      throw new ValidationError('Run does not belong to selected session')
    return run
  }
  private record(id: string, level: PluginDiagnostic['level'], code: string, message = code): void {
    if (!this.registry.has(id)) return
    const diagnostic = {
      at: Date.now(),
      level,
      code,
      message: redactSecretText(message)
        .replaceAll(process.env.HOME ?? '\0', '~')
        .slice(0, 1000)
    }
    this.diagnostics.set(id, [...(this.diagnostics.get(id) ?? []), diagnostic].slice(-100))
    if (level === 'error') log.harness.warn('plugin diagnostic', { pluginId: id, code })
  }
  private async saveResults(): Promise<void> {
    await this.registry.assertMetadataFile('results.json')
    while (
      Buffer.byteLength(JSON.stringify({ results: this.results }, null, 2) + '\n', 'utf8') >
      1024 * 1024
    )
      this.results.shift()
    await this.resultStore.write({ results: this.results })
  }
  private async materializeTeam(
    orchestrator: OrchestratorService,
    team: TeamTemplate,
    cwd: string
  ): Promise<string> {
    const run = await orchestrator.createOrchestration({
      name: team.name,
      cwd,
      strategy: 'dependency',
      maxConcurrentAgents: 3,
      maxConcurrentRuns: 2
    })
    try {
      const agents = new Map<string, string>()
      for (const agent of team.agents) {
        const result = await orchestrator.addAgent(run.id, {
          name: agent.name,
          role: agent.role,
          description: agent.description,
          workspaceMode: agent.workspaceMode,
          isReviewer: agent.isReviewer
        })
        agents.set(agent.key, result.id)
      }
      const taskIds = new Map<string, string>(),
        pending = [...team.tasks]
      while (pending.length) {
        const index = pending.findIndex((t) => t.dependencies.every((d) => taskIds.has(d)))
        if (index < 0) throw new ValidationError('Invalid task DAG')
        const [task] = pending.splice(index, 1)
        const result = await orchestrator.createTask({
          orchestrationId: run.id,
          title: task.title,
          description: task.description,
          assignedAgentId: agents.get(task.agent),
          dependencies: task.dependencies.map((d) => taskIds.get(d)!),
          reviewRequired: task.reviewRequired
        })
        taskIds.set(task.key, result.id)
      }
      return run.id
    } catch (e) {
      await orchestrator.deleteOrchestration(run.id)
      throw e
    }
  }
}
