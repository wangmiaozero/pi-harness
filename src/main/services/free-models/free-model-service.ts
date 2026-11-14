import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { once } from 'node:events'
import type { OpenAICompletionsCompat } from '@earendil-works/pi-ai'
import { z } from 'zod'
import type { PiThinkingLevel } from '@shared/constants'
import { noArgsSchema } from '@shared/schemas/ipc'
import { IPC_INVOKE } from '@shared/ipc/channels'
import {
  FREE_PROVIDER_KEY,
  type FreeModelRow,
  type FreeModelSnapshot
} from '@shared/providers/free-models'
import type { PiConfigService } from '../../pi/config-service'
import { AgentError, ValidationError } from '../errors'
import { log } from '../logger'
import { atomicWriteJson, readJsonFile } from '../storage'
import { buildKiloCatalog, type CatalogEntry } from './ofm/catalog.js'
import { effortPatchFor } from './ofm/effort.js'
import { UpstreamError } from './ofm/http.js'
import { fetchKiloListing, postKiloStreamed } from './ofm/kilo.js'

const REFRESH_INTERVAL = 15_000
const VERIFIED_FOR = 24 * 60 * 60_000
const MAX_REQUEST_BYTES = 32 * 1024 * 1024
const OPEN_CODE_RESTRICTION = 'OpenCode keeps its free models for the OpenCode client.'
const CACHE_VERSION = 2
const cacheSchema = z.object({
  version: z.literal(CACHE_VERSION),
  privacyAccepted: z.boolean(),
  fetchedAt: z.number().nullable(),
  listing: z.array(z.unknown()),
  verified: z.record(z.string(), z.number()).default({})
})
type Cache = z.infer<typeof cacheSchema>

interface Outcome {
  status: FreeModelRow['status']
  until: number
}
interface Registration {
  name: string
  baseUrl: string
  apiKey: string
  api: 'openai-completions'
  authHeader: boolean
  models: Array<{
    id: string
    name: string
    input: Array<'text' | 'image'>
    reasoning: boolean
    contextWindow: number
    maxTokens: number
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
    thinkingLevelMap: Partial<Record<PiThinkingLevel, string | null>>
    compat: OpenAICompletionsCompat
  }>
}

export function registerFreeModelHandlers(
  ipc: { handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void },
  wrap: <T>(run: () => Promise<T>) => Promise<unknown>,
  service: FreeModelService
): void {
  const bind = (channel: string, action: () => Promise<FreeModelSnapshot>) =>
    ipc.handle(channel, (_event, ...args) =>
      wrap(async () => {
        if (!noArgsSchema.safeParse(args).success)
          throw new ValidationError('Invalid free model request')
        return action()
      })
    )
  bind(IPC_INVOKE.freeModelsSnapshot, async () => service.snapshot())
  bind(IPC_INVOKE.freeModelsRefresh, async () => {
    await service.refresh()
    return service.snapshot()
  })
  bind(IPC_INVOKE.freeModelsAcceptPrivacy, () => service.acceptPrivacy())
}

/** Recognize only the previous Harness gateway's generated configuration. */
export async function removeLegacyFreeModelGateway(config: PiConfigService): Promise<void> {
  const isLegacy = (provider: unknown) => {
    const value = provider as
      { api?: string; baseUrl?: string; apiKey?: string; models?: { id: string }[] } | undefined
    return (
      value?.api === 'openai-completions' &&
      /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(value.baseUrl ?? '') &&
      /^[\w-]{32}$/.test(value.apiKey ?? '') &&
      Array.isArray(value.models) &&
      value.models.every((model) => /^(kilo|opencode)\//.test(model.id))
    )
  }
  if (!isLegacy((await config.read()).models.providers[FREE_PROVIDER_KEY])) return
  await config.patchProvider(
    FREE_PROVIDER_KEY,
    (provider) => (isLegacy(provider) ? undefined : provider),
    { reason: 'retire the previous built-in free model gateway', skipBackup: true }
  )
}

export class FreeModelService {
  private readonly token = randomBytes(24).toString('base64url')
  private readonly shutdown = new AbortController()
  private server?: ReturnType<typeof createServer>
  private listening?: Promise<string>
  private readonly requests = new Set<Promise<void>>()
  private cache: Cache = {
    version: CACHE_VERSION,
    privacyAccepted: false,
    fetchedAt: null,
    listing: [],
    verified: {}
  }
  private readonly models = new Map<string, CatalogEntry>()
  private readonly outcomes = new Map<string, Outcome>()
  private cooldown?: Outcome
  private catalog: FreeModelSnapshot['catalog'] = 'loading'
  private refreshing?: Promise<void>
  private lastRefresh = 0
  private pendingSave?: Promise<void>
  private consentWrite?: Promise<FreeModelSnapshot>
  private readonly ready: Promise<void>

  constructor(
    private readonly directory: string,
    private readonly notify: (snapshot: FreeModelSnapshot) => void,
    private readonly upstream = { listing: fetchKiloListing, stream: postKiloStreamed }
  ) {
    this.ready = this.readCache()
    void this.refresh()
  }

  async stop(): Promise<void> {
    this.shutdown.abort()
    await this.listening?.catch(() => {})
    if (this.server?.listening) {
      const closed = new Promise<void>((resolve) => this.server!.close(() => resolve()))
      this.server.closeAllConnections()
      await closed
    }
    await Promise.allSettled([
      this.refreshing,
      this.consentWrite,
      ...this.requests,
      this.pendingSave
    ])
  }

  async snapshot(): Promise<FreeModelSnapshot> {
    await this.ready
    const now = Date.now()
    return {
      models: [...this.models].map(([id, model]) => {
        const result = this.outcomes.get(id)
        const outcome = result && result.until > now ? result : undefined
        const cooldown = this.cooldown && this.cooldown.until > now ? this.cooldown : undefined
        const available =
          this.catalog === 'ready' &&
          !this.cacheExpired(now) &&
          (this.cache.verified[id] ?? 0) + VERIFIED_FOR > now
        return {
          id,
          name: model.name,
          source: 'Kilo',
          status: outcome?.status ?? cooldown?.status ?? (available ? 'available' : 'unverified'),
          reasoning: model.reasoning,
          vision: model.vision,
          tools: model.tools,
          thinkingLevels: thinkingMap(model),
          retryAt: (outcome ?? cooldown)?.until
        }
      }),
      fetchedAt: this.cache.fetchedAt,
      stale: this.cache.fetchedAt !== null && this.catalog !== 'ready',
      refreshing: Boolean(this.refreshing),
      privacyAccepted: this.cache.privacyAccepted,
      catalog: this.catalog
    }
  }

  acceptPrivacy(): Promise<FreeModelSnapshot> {
    this.consentWrite ??= this.ready
      .then(async () => {
        const next = { ...this.cache, privacyAccepted: true }
        await atomicWriteJson(this.cachePath, next)
        this.cache.privacyAccepted = true
        this.changed()
        return this.snapshot()
      })
      .finally(() => {
        this.consentWrite = undefined
      })
    return this.consentWrite
  }

  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    if (this.shutdown.signal.aborted || Date.now() - this.lastRefresh < REFRESH_INTERVAL)
      return Promise.resolve()
    this.lastRefresh = Date.now()
    this.refreshing = this.ready
      .then(() => this.loadCatalog())
      .finally(() => {
        this.refreshing = undefined
        this.changed()
      })
    this.changed()
    return this.refreshing
  }

  async assertSelectable(modelId: string | undefined): Promise<void> {
    await this.ready
    if (modelId?.startsWith('opencode/')) throw new AgentError(OPEN_CODE_RESTRICTION)
    if (!this.cache.privacyAccepted)
      throw new AgentError('Confirm the free-model privacy notice before sending a prompt.')
    if (!modelId || !this.models.get(modelId)?.tools)
      throw new AgentError('This free model is unavailable for Pi tools. Select another model.')
  }

  async registration(restoredId?: string): Promise<Registration | null> {
    await this.ready
    if (!this.cache.privacyAccepted && !restoredId) return null
    const models = [...this.models].filter(([, model]) => model.tools)
    if (
      restoredId &&
      /^(kilo|opencode)\/[a-zA-Z0-9][-a-zA-Z0-9_.:/]{0,199}$/.test(restoredId) &&
      !models.some(([id]) => id === restoredId)
    ) {
      // Keep Pi's historical model ID. The gateway checks the current roster
      // on each request, so a removed model cannot be sent upstream.
      models.push([
        restoredId,
        {
          id: restoredId,
          name: restoredId.slice(restoredId.indexOf('/') + 1),
          reasoning: false,
          vision: false,
          tools: false,
          contextWindow: 131_072,
          maxOutput: 4_096,
          canDisableThinking: false
        }
      ])
    }
    if (!models.length || this.shutdown.signal.aborted) return null
    this.listening ??= this.listen().catch((error: unknown) => {
      this.listening = undefined
      throw error
    })
    return {
      name: 'Free Models',
      baseUrl: await this.listening,
      apiKey: this.token,
      api: 'openai-completions',
      authHeader: true,
      models: models.map(([id, model]) => ({
        id,
        name: model.name,
        reasoning: model.reasoning,
        input: model.vision ? ['text', 'image'] : ['text'],
        contextWindow: model.contextWindow,
        maxTokens: model.maxOutput,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        thinkingLevelMap: thinkingMap(model),
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: model.reasoning,
          maxTokensField: 'max_tokens'
        }
      }))
    }
  }

  private get cachePath(): string {
    return path.join(this.directory, 'catalog.json')
  }

  private async readCache(): Promise<void> {
    try {
      const parsed = cacheSchema.safeParse(await readJsonFile(this.cachePath))
      if (parsed.success) {
        this.cache = parsed.data
        this.replaceModels()
      }
    } catch {
      log.provider.warn('Could not read the free model cache')
    }
  }

  private async loadCatalog(): Promise<void> {
    try {
      const payload = (await this.upstream.listing({ signal: this.shutdown.signal })) as {
        data: unknown[]
      }
      this.cache.listing = payload.data
      this.cache.fetchedAt = Date.now()
      this.replaceModels()
      this.catalog = 'ready'
      this.changed()
      await this.save()
    } catch {
      if (!this.shutdown.signal.aborted) this.catalog = 'offline'
    }
  }

  private replaceModels(): void {
    this.models.clear()
    for (const model of buildKiloCatalog(this.cache.listing))
      this.models.set(`kilo/${model.id}`, model)
    for (const id of Object.keys(this.cache.verified))
      if (!this.models.has(id)) delete this.cache.verified[id]
    for (const id of this.outcomes.keys()) if (!this.models.has(id)) this.outcomes.delete(id)
  }

  private cacheExpired(now: number): boolean {
    return this.cache.fetchedAt === null || this.cache.fetchedAt + VERIFIED_FOR <= now
  }

  private save(): Promise<void> {
    const pending = this.writeCache().finally(() => {
      if (this.pendingSave === pending) this.pendingSave = undefined
    })
    this.pendingSave = pending
    return pending
  }

  private async writeCache(): Promise<void> {
    if (this.consentWrite) await this.consentWrite.catch(() => {})
    try {
      await atomicWriteJson(this.cachePath, this.cache)
    } catch {
      log.provider.warn('Could not save the free model cache')
    }
  }

  private changed(): void {
    void this.snapshot().then(this.notify)
  }

  private async listen(): Promise<string> {
    const server = createServer((request, response) => {
      const pending = this.handle(request, response)
      this.requests.add(pending)
      void pending.finally(() => this.requests.delete(pending))
    })
    this.server = server
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Free model gateway could not listen')
    return `http://127.0.0.1:${address.port}/v1`
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      sendError(response, 401, 'Free model gateway refused the request.')
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      sendError(response, 404, 'Unknown free model route.')
      return
    }
    if (!this.cache.privacyAccepted) {
      sendError(response, 403, 'Confirm the free-model privacy notice before sending a prompt.')
      return
    }
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, this.shutdown.signal])
    response.once('close', () => controller.abort())
    let body: Record<string, unknown>
    try {
      body = await readBody(request)
    } catch (error) {
      if (!response.destroyed)
        sendError(
          response,
          error instanceof RangeError ? 413 : 400,
          'Invalid free model request body.'
        )
      return
    }
    const id = String(body.model ?? '')
    const model = this.models.get(id)
    if (id.startsWith('opencode/')) {
      sendError(response, 403, OPEN_CODE_RESTRICTION)
      return
    }
    if (!model?.tools) {
      sendError(response, 404, 'This free model is unavailable for Pi tools. Select another model.')
      return
    }
    const now = Date.now()
    const outcome = this.outcomes.get(id)
    const blocked = [this.cooldown, outcome].find(
      (entry) =>
        entry && (entry.status === 'limited' || entry.status === 'quota') && entry.until > now
    )
    if (blocked) {
      sendError(response, 429, failureMessage(blocked.status), blocked.until - now)
      return
    }
    const effort = typeof body.reasoning_effort === 'string' ? body.reasoning_effort : undefined
    delete body.reasoning_effort
    delete body.user
    body.model = model.id
    body.stream = true
    // A live Pi session may still hold limits from an earlier catalog.
    if (typeof body.max_tokens === 'number' && body.max_tokens > model.maxOutput)
      body.max_tokens = model.maxOutput
    Object.assign(body, effortPatchFor(effort, model))
    try {
      await this.upstream.stream({
        body,
        signal,
        onData: (data) => {
          if (signal.aborted || response.destroyed) return
          if (!response.headersSent)
            response.writeHead(200, {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache'
            })
          response.write(`data: ${data}\n\n`)
        }
      })
      signal.throwIfAborted()
      const finished = Date.now()
      const previous = this.cache.verified[id]
      const statusChanged = this.outcomes.delete(id)
      if (this.cooldown && this.cooldown.until <= finished) this.cooldown = undefined
      response.end('data: [DONE]\n\n')
      if (!this.models.has(id)) return
      if (!previous || finished - previous >= VERIFIED_FOR / 2 || statusChanged) {
        this.cache.verified[id] = finished
        await this.save()
        this.changed()
      }
    } catch (error) {
      if (signal.aborted || response.destroyed) return
      const status = failureStatus(error)
      const retry = error instanceof UpstreamError ? error.providerRetryAfterMs : undefined
      const until = Date.now() + (retry ?? (status === 'quota' ? 60 * 60_000 : 60_000))
      const result = { status, until }
      if (!(
        error instanceof UpstreamError &&
        error.code === 'CLIENT_ERROR' &&
        error.status === 400
      ))
        this.outcomes.set(id, result)
      // Kilo's public anonymous requests share an IP-level allowance.
      if (status === 'limited') this.cooldown = result
      if (status === 'region' || status === 'unavailable' || status === 'quota') {
        delete this.cache.verified[id]
        void this.save()
      }
      this.changed()
      const invalid = error instanceof UpstreamError && error.code === 'CLIENT_ERROR'
      const message =
        invalid && error.message === 'The request exceeds the context window'
          ? error.message
          : invalid && error.status === 400
            ? 'Kilo rejected this request for the selected model.'
            : failureMessage(status)
      if (response.headersSent) {
        response.end(
          `event: error\ndata: ${JSON.stringify({ error: { message, ...quotaError(status) } })}\n\n`
        )
      } else {
        const code =
          error instanceof UpstreamError && error.status && error.status >= 400
            ? error.status
            : status === 'limited'
              ? 429
              : 502
        sendError(
          response,
          code,
          message,
          status === 'limited' || status === 'quota' ? until - Date.now() : undefined
        )
      }
    }
  }
}

function thinkingMap(model: CatalogEntry): Registration['models'][number]['thinkingLevelMap'] {
  const levels = model.efforts ?? []
  return {
    off: levels.includes('disabled') ? 'disabled' : null,
    minimal: null,
    low: levels.includes('low') ? 'low' : null,
    medium: levels.includes('medium') ? 'medium' : null,
    high: levels.includes('high') ? 'high' : null,
    xhigh: null,
    max: null
  }
}

function failureStatus(error: unknown): FreeModelRow['status'] {
  if (!(error instanceof UpstreamError)) return 'upstream'
  if (error.code === 'RATE_LIMIT') return 'limited'
  if (error.code === 'QUOTA_EXHAUSTED') return 'quota'
  if (error.code === 'REGION_BLOCKED') return 'region'
  if (error.unavailable || [401, 403, 404].includes(error.status ?? 0)) return 'unavailable'
  return 'upstream'
}

function failureMessage(status: FreeModelRow['status']): string {
  if (status === 'limited')
    return 'Kilo free requests are rate limited. Try again after the cooldown.'
  if (status === 'quota') return 'The upstream free quota is exhausted. Try again later.'
  if (status === 'region') return 'Kilo returned a restriction for your region.'
  if (status === 'unavailable') return 'Kilo currently refuses anonymous access to this model.'
  return 'The Kilo request failed or the stream was interrupted. Try again later.'
}

function sendError(
  response: ServerResponse,
  status: number,
  message: string,
  retryMs?: number
): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'x-should-retry': 'false',
    ...(retryMs ? { 'retry-after': String(Math.max(1, Math.ceil(retryMs / 1000))) } : {})
  })
  response.end(
    JSON.stringify({ error: { message, ...quotaError(retryMs ? 'limited' : undefined) } })
  )
}

function quotaError(status?: FreeModelRow['status']): { code?: string } {
  // Pi recognizes this code as a provider limit and will not replay a turn
  // while the gateway is enforcing an anonymous quota or cooldown.
  return status === 'quota' || status === 'limited' ? { code: 'insufficient_quota' } : {}
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) {
      request.resume()
      throw new RangeError()
    }
    chunks.push(chunk)
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    typeof body.model !== 'string' ||
    !Array.isArray(body.messages)
  )
    throw new Error('Invalid body')
  return body
}
