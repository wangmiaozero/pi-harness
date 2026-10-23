import { jsonSchema } from '@shared/harness-plugins/schema'
import { z } from 'zod'
import type { Contribution, PluginManifest } from '../../../../packages/harness-plugin-sdk'

export interface PluginTransport {
  send(message: unknown): void
  onMessage(listener: (message: unknown) => void): () => void
  onExit(listener: () => void): () => void
  kill(): void
}
export type PluginProcessFactory = (entry: string) => PluginTransport
const logsSchema = z
  .array(
    z.strictObject({ message: z.string().max(1000), metadata: z.record(z.string(), jsonSchema) })
  )
  .max(20)
export type PluginProcessLog = z.infer<typeof logsSchema>[number]
const responseSchema = z.strictObject({
  id: z.number().int().positive(),
  ok: z.boolean(),
  value: z.unknown().optional(),
  error: z.string().max(500).optional(),
  logs: logsSchema.optional()
})
export const registrationSchema = z.strictObject({
  evaluators: z
    .array(z.strictObject({ id: z.string().max(64), version: z.string().max(64) }))
    .max(8),
  exporters: z.array(z.strictObject({ id: z.string().max(64), version: z.string().max(64) })).max(8)
})
export function boundedJson(
  value: unknown,
  limit = 256 * 1024,
  maxNodes = 16000,
  maxDepth = 12
): void {
  let count = 0
  function visit(v: unknown, depth: number): void {
    if (depth > maxDepth || ++count > maxNodes) throw new Error('PLUGIN_OUTPUT_LIMIT')
    if (v && typeof v === 'object') for (const child of Object.values(v)) visit(child, depth + 1)
  }
  visit(value, 0)
  if (Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') > limit)
    throw new Error('PLUGIN_OUTPUT_LIMIT')
}

/** Process isolation only. Trusted native code is not a security sandbox. */
export class PluginProcessHost {
  private nextId = 0
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void
      reject: (e: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private cleanup: Array<() => void> = []
  private stopped = false
  constructor(
    private transport: PluginTransport,
    private fault: (code: string) => void,
    private diagnostics: (logs: PluginProcessLog[]) => void = () => {}
  ) {
    this.cleanup.push(
      transport.onMessage((message) => {
        if (this.stopped) return
        try {
          boundedJson(message)
          const parsed = responseSchema.safeParse(message)
          if (!parsed.success) {
            this.stop('PLUGIN_PROTOCOL_ERROR')
            return
          }
          const p = this.pending.get(parsed.data.id)
          if (!p) return
          if (parsed.data.logs?.length) this.diagnostics(parsed.data.logs)
          clearTimeout(p.timer)
          this.pending.delete(parsed.data.id)
          if (parsed.data.ok) p.resolve(parsed.data.value)
          else p.reject(new Error('PLUGIN_EXECUTION_FAILED'))
        } catch {
          this.stop('PLUGIN_OUTPUT_LIMIT')
        }
      }),
      transport.onExit(() => this.stop('PLUGIN_PROCESS_EXIT'))
    )
  }
  request(method: string, payload: unknown, timeout = 2000): Promise<unknown> {
    if (this.stopped) return Promise.reject(new Error('PLUGIN_PROCESS_STOPPED'))
    if (this.pending.size >= 2) return Promise.reject(new Error('PLUGIN_QUEUE_FULL'))
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => this.stop('PLUGIN_TIMEOUT'), timeout)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.transport.send({ id, method, payload })
      } catch {
        this.stop('PLUGIN_PROCESS_EXIT')
      }
    })
  }
  async activate(
    manifest: PluginManifest,
    // Activation includes forking the child and importing the worker plus plugin entry, so the
    // cold-start budget must exceed the per-request timeout used for warm round-trips.
    timeout = 10000
  ): Promise<{ evaluators: Contribution[]; exporters: Contribution[] }> {
    const registrations = registrationSchema.parse(await this.request('activate', manifest, timeout))
    for (const name of ['evaluators', 'exporters'] as const) {
      const expected = manifest.contributions[name]
      if (
        registrations[name].length !== expected.length ||
        registrations[name].some(
          (c) => !expected.some((e) => e.id === c.id && e.version === c.version)
        ) ||
        new Set(registrations[name].map((c) => c.id)).size !== registrations[name].length
      )
        throw new Error('PLUGIN_INVALID_REGISTRATION')
    }
    return registrations
  }
  stop(code?: string): void {
    if (this.stopped) return
    this.stopped = true
    for (const remove of this.cleanup) remove()
    this.cleanup = []
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error(code ?? 'PLUGIN_DISABLED'))
    }
    this.pending.clear()
    this.transport.kill()
    if (code) this.fault(code)
  }
}
