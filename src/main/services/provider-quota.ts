import { createHash } from 'node:crypto'
import { setTimeout as waitForRetry } from 'node:timers/promises'
import { z } from 'zod'
import type { QuotaReading, QuotaWindow } from '@shared/providers/account-management'
import type { ProviderService } from './provider-service'
import { readBoundedJson } from './bounded-json'

const refreshFloorMs = 60_000
const staleAfterMs = 15 * 60_000

export const deepSeekBalanceSchema = z.object({
  is_available: z.boolean().optional(),
  balance_infos: z
    .array(
      z.object({
        currency: z.string().regex(/^[A-Z]{3}$/),
        total_balance: z.string().regex(/^-?\d{1,30}(\.\d{1,16})?$/)
      })
    )
    .min(1)
    .max(20)
})

type QuotaResult = Pick<QuotaReading, 'status' | 'balances' | 'keyLimit' | 'windows'> & {
  retryAfterMs?: number
  retryable?: boolean
}

interface QuotaAdapter {
  source: NonNullable<QuotaReading['source']>
  kind: NonNullable<QuotaReading['kind']>
  baseUrls: readonly string[]
  endpoint: string
  supportsKey?(apiKey: string): boolean
  parse(value: unknown): QuotaResult
}

const openRouterKeySchema = z.object({
  data: z.object({
    limit: z.number().nonnegative().nullish(),
    limit_remaining: z.number().nullish(),
    usage: z.number().nonnegative().nullish(),
    limit_reset: z.string().nullish()
  })
})

const miniMaxPercent = z.number().min(0).max(100).nullish()
const miniMaxTimestamp = z.number().int().min(946_684_800_000).max(4_102_444_800_000)
const miniMaxPlanSchema = z.object({
  base_resp: z.object({ status_code: z.number().int() }).optional(),
  model_remains: z
    .array(
      z.object({
        model_name: z.string(),
        current_interval_status: z.number().nullish(),
        current_weekly_status: z.number().nullish(),
        current_interval_remaining_percent: miniMaxPercent,
        current_weekly_remaining_percent: miniMaxPercent,
        end_time: z.number().nullish(),
        weekly_end_time: z.number().nullish(),
        weekly_boost_permille: z.number().positive().max(10_000).nullish()
      })
    )
    .max(100)
    .optional()
})

function miniMaxWindow(
  model: string,
  window: QuotaWindow['window'],
  percent: number | null | undefined,
  reset: number | null | undefined,
  status: number | null | undefined
): QuotaWindow {
  return {
    model,
    window,
    remainingPercent: status === 3 ? undefined : (percent ?? undefined),
    resetAt: status === 3 ? undefined : miniMaxTimestamp.safeParse(reset).data,
    availability:
      status === 1 ? 'limited' : status === 2 ? 'exhausted' : status === 3 ? 'unlimited' : undefined
  }
}

function miniMaxPlan(origin: string): QuotaAdapter {
  return {
    source: 'minimax',
    kind: 'subscription',
    baseUrls: [origin + '/anthropic/v1', origin + '/v1'],
    endpoint: origin + '/v1/token_plan/remains',
    supportsKey: (key) => key.startsWith('sk-cp-'),
    parse(value) {
      const { base_resp, model_remains } = miniMaxPlanSchema.parse(value)
      if ((base_resp && base_resp.status_code !== 0) || !model_remains) return { status: 'failed' }
      const windows: QuotaWindow[] = []
      for (const item of model_remains) {
        const model = item.model_name
        if (!/^[A-Za-z0-9_.* -]{1,100}$/.test(model) || model.startsWith('sk-')) continue
        const weekly = item.current_weekly_remaining_percent
        windows.push(
          miniMaxWindow(
            model,
            'current',
            item.current_interval_remaining_percent,
            item.end_time,
            item.current_interval_status
          ),
          miniMaxWindow(
            model,
            'weekly',
            weekly == null ? undefined : (weekly * (item.weekly_boost_permille ?? 1000)) / 1000,
            item.weekly_end_time,
            item.current_weekly_status
          )
        )
      }
      return { status: 'ok', windows }
    }
  }
}

const quotaAdapters: readonly QuotaAdapter[] = [
  {
    source: 'deepseek',
    kind: 'balance',
    baseUrls: ['https://api.deepseek.com', 'https://api.deepseek.com/v1'],
    endpoint: 'https://api.deepseek.com/user/balance',
    parse(value) {
      const balance = deepSeekBalanceSchema.parse(value)
      return {
        status: balance.is_available === false ? 'insufficient' : 'ok',
        balances: balance.balance_infos.map(({ currency, total_balance }) => ({
          currency,
          available: total_balance
        }))
      }
    }
  },
  {
    source: 'openrouter',
    kind: 'keyLimit',
    baseUrls: ['https://openrouter.ai/api/v1'],
    endpoint: 'https://openrouter.ai/api/v1/key',
    parse(value) {
      const { data } = openRouterKeySchema.parse(value)
      const reset = data.limit_reset
      return {
        status: data.limit_remaining != null && data.limit_remaining <= 0 ? 'insufficient' : 'ok',
        keyLimit: {
          limit: data.limit ?? undefined,
          remaining: data.limit_remaining ?? undefined,
          usage: data.usage ?? undefined,
          resetPeriod:
            reset === 'daily' || reset === 'weekly' || reset === 'monthly' ? reset : undefined
        }
      }
    }
  },
  miniMaxPlan('https://api.minimax.io'),
  miniMaxPlan('https://api.minimaxi.com')
]

async function fetchQuota(
  fetcher: typeof fetch,
  adapter: QuotaAdapter,
  apiKey: string,
  signal: AbortSignal
): Promise<QuotaResult> {
  const response = await fetcher(adapter.endpoint, {
    signal,
    redirect: 'error',
    headers: { authorization: `Bearer ${apiKey}` }
  })
  if (response.ok) return adapter.parse(await readBoundedJson(response, 32_768))
  const header = response.headers.get('retry-after')
  await response.body?.cancel()
  if (response.status === 401 || response.status === 403) return { status: 'unauthorized' }
  if (response.status === 429) {
    const ms =
      header && /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header ?? '') - Date.now()
    return { status: 'rateLimited', retryAfterMs: Number.isFinite(ms) ? ms : refreshFloorMs }
  }
  return { status: 'failed', retryable: response.status >= 500 && !header }
}

export class ProviderQuota {
  private readonly shutdown = new AbortController()
  private readonly cache = new Map<
    string,
    {
      identity: string
      reading: QuotaReading
      nextAt: number
    }
  >()
  private readonly pending = new Map<string, Promise<QuotaReading>>()

  constructor(
    private readonly providers: Pick<ProviderService, 'get' | 'readBalanceApiKey'>,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  close(): void {
    this.shutdown.abort()
  }

  async read(provider: string): Promise<QuotaReading> {
    const profile = await this.providers.get(provider)
    const adapter = quotaAdapters.find(
      (entry) => profile && entry.baseUrls.includes(profile.baseUrl.replace(/\/+$/, ''))
    )
    if (!profile || !adapter) {
      this.cache.delete(provider)
      return { provider, status: 'unsupported' }
    }
    const initial = { provider, source: adapter.source, kind: adapter.kind }
    let apiKey: string | null
    try {
      apiKey = await this.providers.readBalanceApiKey(provider, profile.baseUrl)
    } catch {
      this.cache.delete(provider)
      return { ...initial, status: 'unauthorized' }
    }
    if (!apiKey) {
      this.cache.delete(provider)
      return { ...initial, status: 'unauthorized' }
    }
    if (adapter.supportsKey && !adapter.supportsKey(apiKey)) {
      this.cache.delete(provider)
      return { ...initial, status: 'unsupported' }
    }
    const identity = adapter.source + ':' + createHash('sha256').update(apiKey).digest('hex')
    const key = provider + ':' + identity
    const existing = this.pending.get(key)
    if (existing) return existing
    const cached = this.cache.get(provider)
    const prior = cached?.identity === identity ? cached : null
    if (prior && prior.nextAt > Date.now()) return prior.reading

    const request = (async () => {
      const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(10_000)])
      const fetchBalance = async () => {
        const first = await fetchQuota(this.fetcher, adapter, apiKey, signal)
        if (!first.retryable) return first
        await waitForRetry(250, undefined, { signal })
        return fetchQuota(this.fetcher, adapter, apiKey, signal)
      }
      const result: QuotaResult = await fetchBalance().catch(() => ({ status: 'failed' }))
      const checkedAt = Date.now()
      const keep =
        (result.status === 'failed' || result.status === 'rateLimited') &&
        prior?.reading.checkedAt !== undefined &&
        checkedAt - prior.reading.checkedAt < staleAfterMs
          ? prior.reading
          : null
      const reading: QuotaReading = {
        ...initial,
        status: keep?.balances || keep?.keyLimit || keep?.windows ? 'stale' : result.status,
        checkedAt: keep?.checkedAt ?? checkedAt,
        balances: result.balances ?? keep?.balances,
        keyLimit: result.keyLimit ?? keep?.keyLimit,
        windows: result.windows ?? keep?.windows
      }
      const wait = Math.max(refreshFloorMs, result.retryAfterMs ?? 0)
      this.cache.set(provider, { identity, reading, nextAt: checkedAt + wait })
      return reading
    })()
    this.pending.set(key, request)
    return request.finally(() => this.pending.delete(key))
  }
}
