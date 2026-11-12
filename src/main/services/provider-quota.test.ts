import { afterEach, expect, it, vi } from 'vitest'
import { ProviderQuota } from './provider-quota'
import type { ProviderProfile } from '@shared/types/domain'

afterEach(() => vi.useRealTimers())

function providers(baseUrl = 'https://api.deepseek.com/v1') {
  return {
    get: vi.fn(async (_key: string) => ({ baseUrl }) as ProviderProfile),
    readBalanceApiKey: vi.fn(async (_key: string, _url: string) => 'fixture-secret')
  }
}

it('coalesces requests, keeps a bounded stale reading and invalidates rotated credentials', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ balance_infos: [{ currency: 'USD', total_balance: '1.25' }] })
    )
    .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '120' } }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
  const input = providers()
  const quota = new ProviderQuota(input, fetcher)
  const [first, second] = await Promise.all([quota.read('deepseek'), quota.read('deepseek')])
  expect(first).toEqual(second)
  expect(first).toMatchObject({ status: 'ok', balances: [{ currency: 'USD', available: '1.25' }] })
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    'https://api.deepseek.com/user/balance',
    expect.objectContaining({ redirect: 'error' })
  )
  vi.setSystemTime(Date.now() + 61_000)
  expect(await quota.read('deepseek')).toMatchObject({
    status: 'stale',
    checkedAt: first.checkedAt
  })
  expect(await quota.read('deepseek')).toMatchObject({ status: 'stale' })
  expect(fetcher).toHaveBeenCalledTimes(2)
  input.readBalanceApiKey.mockResolvedValue('fixture-replaced')
  expect(await quota.read('deepseek')).toMatchObject({
    status: 'unauthorized',
    balances: undefined
  })
})

it('does not resolve a secret for another host and rejects invalid amounts', async () => {
  const input = providers('https://api.deepseek.com.example.invalid/v1')
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ balance_infos: [{ currency: 'USD', total_balance: null }] }))
  expect(await new ProviderQuota(input, fetcher).read('deepseek')).toMatchObject({
    status: 'unsupported'
  })
  expect(input.readBalanceApiKey).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
  expect(await new ProviderQuota(providers(), fetcher).read('deepseek')).toMatchObject({
    status: 'failed',
    balances: undefined
  })
})

it('retries a temporary server failure once and reports an insufficient balance as current', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        is_available: true,
        balance_infos: [{ currency: 'USD', total_balance: '1' }]
      })
    )
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(
      Response.json({
        is_available: false,
        balance_infos: [{ currency: 'USD', total_balance: '0' }]
      })
    )
  const quota = new ProviderQuota(providers(), fetcher)
  await quota.read('deepseek')
  vi.setSystemTime(Date.now() + 61_000)
  expect(await quota.read('deepseek')).toMatchObject({
    status: 'insufficient',
    balances: [{ currency: 'USD', available: '0' }],
    checkedAt: Date.now()
  })
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it('reports OpenRouter spend and key limits without inferring a reset timestamp', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
    Response.json({
      data: {
        limit: null,
        limit_remaining: null,
        usage: 12.5,
        limit_reset: 'weekly',
        label: 'private'
      }
    })
  )
  const result = await new ProviderQuota(providers('https://openrouter.ai/api/v1'), fetcher).read(
    'router'
  )
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    'https://openrouter.ai/api/v1/key',
    expect.objectContaining({ redirect: 'error' })
  )
  expect(result).toMatchObject({
    source: 'openrouter',
    kind: 'keyLimit',
    status: 'ok',
    keyLimit: { usage: 12.5, resetPeriod: 'weekly', remaining: undefined, limit: undefined }
  })
  expect(result.balances).toBeUndefined()
  expect(JSON.stringify(result)).not.toContain('private')
})

it('reports MiniMax Token Plan windows using explicit values and the configured region', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
    Response.json({
      base_resp: { status_code: 0 },
      model_remains: [
        {
          model_name: 'MiniMax-M*',
          current_interval_remaining_percent: 52.25,
          current_interval_status: 1,
          end_time: 1_777_000_000_000,
          weekly_end_time: 0,
          current_weekly_usage_count: 15,
          current_weekly_total_count: 100
        },
        {
          model_name: 'unlimited-model',
          current_interval_status: 3,
          end_time: 1_777_000_000_000,
          current_weekly_remaining_percent: 80,
          weekly_boost_permille: 1500
        }
      ]
    })
  )
  const input = providers('https://api.minimaxi.com/anthropic/v1')
  input.readBalanceApiKey
    .mockResolvedValueOnce('sk-api-fixture')
    .mockResolvedValueOnce('sk-cp-fixture')
  const quota = new ProviderQuota(input, fetcher)
  expect(await quota.read('minimax-cn')).toMatchObject({ status: 'unsupported' })
  expect(fetcher).not.toHaveBeenCalled()
  expect(await quota.read('minimax-cn')).toMatchObject({
    source: 'minimax',
    kind: 'subscription',
    status: 'ok',
    windows: [
      {
        model: 'MiniMax-M*',
        window: 'current',
        remainingPercent: 52.25,
        resetAt: 1_777_000_000_000,
        availability: 'limited'
      },
      { model: 'MiniMax-M*', window: 'weekly', remainingPercent: undefined, resetAt: undefined },
      {
        model: 'unlimited-model',
        window: 'current',
        availability: 'unlimited',
        resetAt: undefined
      },
      { model: 'unlimited-model', window: 'weekly', remainingPercent: 120 }
    ]
  })
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    'https://api.minimaxi.com/v1/token_plan/remains',
    expect.objectContaining({
      redirect: 'error',
      headers: { authorization: 'Bearer sk-cp-fixture' }
    })
  )
})
