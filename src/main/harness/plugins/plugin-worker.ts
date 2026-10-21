/** Dedicated utility-process entry. Never imported into Main or Renderer. */
import { pathToFileURL } from 'node:url'
import type {
  HarnessPlugin,
  PluginContext,
  PluginManifest,
  PluginEvent,
  RunEvidence,
  AuthorizedTrace,
  Contribution,
  EvaluatorResult,
  JsonValue,
  PluginEventType
} from '../../../../packages/harness-plugin-sdk'
import { boundedJson } from './process-host'
import {
  pluginManifestSchema,
  evidenceSchema,
  traceSchema,
  eventSchema,
  evaluatorResultSchema,
  jsonSchema
} from '@shared/harness-plugins/schema'

const port = process.parentPort
const send = (value: unknown): void => {
  boundedJson(value)
  if (port) port.postMessage(value)
  else process.send?.(value)
}
let plugin: HarnessPlugin | null = null,
  manifest: PluginManifest | null = null
const subscriptions = new Set<{
  types: readonly PluginEventType[]
  listener: (event: Readonly<PluginEvent>) => void | Promise<void>
}>()
const evaluators = new Map<
  string,
  {
    definition: Contribution
    handler: (evidence: Readonly<RunEvidence>) => EvaluatorResult | Promise<EvaluatorResult>
  }
>()
const exporters = new Map<
  string,
  {
    definition: Contribution
    handler: (trace: Readonly<AuthorizedTrace>) => JsonValue | Promise<JsonValue>
  }
>()
let logs: Array<{ message: string; metadata: Record<string, JsonValue> }> = []
function requirePermission(permission: PluginManifest['permissions'][number]): void {
  if (!manifest?.permissions.includes(permission)) throw new Error('Permission not declared')
}
const api: PluginContext = {
  apiVersion: '1.0.0',
  events: {
    subscribe(types, listener) {
      requirePermission('events:read')
      if (types.some((t) => !manifest!.contributions.events.includes(t)))
        throw new Error('Undeclared event')
      const item = { types: [...types], listener }
      subscriptions.add(item)
      return () => {
        subscriptions.delete(item)
      }
    }
  },
  evaluators: {
    register(definition, handler) {
      requirePermission('evaluation:read')
      if (evaluators.has(definition.id)) throw new Error('Duplicate evaluator')
      evaluators.set(definition.id, { definition, handler })
      return () => {
        evaluators.delete(definition.id)
      }
    }
  },
  exporters: {
    register(definition, handler) {
      requirePermission('trace:read')
      if (exporters.has(definition.id)) throw new Error('Duplicate exporter')
      exporters.set(definition.id, { definition, handler })
      return () => {
        exporters.delete(definition.id)
      }
    }
  },
  diagnostics: {
    log(message, metadata = {}) {
      if (logs.length < 20) {
        const value = { message: message.slice(0, 1000), metadata }
        boundedJson(value, 8000)
        logs.push(value)
      }
    }
  }
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}
async function handle(method: string, payload: unknown): Promise<unknown> {
  if (method === 'activate') {
    manifest = pluginManifestSchema.parse(payload)
    const module = await import(/* @vite-ignore */ pathToFileURL(process.argv[2]).href)
    plugin = module.default as HarnessPlugin
    if (!plugin || typeof plugin.activate !== 'function') throw new Error('Missing activate export')
    await plugin.activate(freeze(api))
    return {
      evaluators: [...evaluators.values()].map((v) => v.definition),
      exporters: [...exporters.values()].map((v) => v.definition)
    }
  }
  if (method === 'event') {
    const event = freeze(eventSchema.parse(payload))
    for (const item of subscriptions)
      if (item.types.includes(event.event.type)) await item.listener(event)
    return null
  }
  if (method === 'evaluate') {
    const input = payload as { id: string; evidence: unknown },
      entry = evaluators.get(input.id)
    if (!entry) throw new Error('Unknown evaluator')
    return evaluatorResultSchema.parse(
      await entry.handler(freeze(evidenceSchema.parse(input.evidence)))
    )
  }
  if (method === 'export') {
    const input = payload as { id: string; trace: unknown },
      entry = exporters.get(input.id)
    if (!entry) throw new Error('Unknown exporter')
    const value = await entry.handler(freeze(traceSchema.parse(input.trace)))
    boundedJson(value)
    return jsonSchema.parse(value)
  }
  if (method === 'deactivate') {
    try {
      await plugin?.deactivate?.()
    } finally {
      subscriptions.clear()
      evaluators.clear()
      exporters.clear()
      logs = []
      plugin = null
    }
    return null
  }
  throw new Error('Unsupported request')
}
function receive(message: unknown): void {
  const value = message as { id: number; method: string; payload: unknown }
  void handle(value.method, value.payload)
    .then((result) => {
      const messages = logs
      logs = []
      send({ id: value.id, ok: true, value: result, logs: messages })
    })
    .catch(() => {
      const messages = logs
      logs = []
      send({ id: value.id, ok: false, error: 'Plugin operation failed', logs: messages })
    })
}
if (port) port.on('message', (event) => receive(event.data))
else process.on('message', receive)
