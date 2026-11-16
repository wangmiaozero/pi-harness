// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { chatGptPlanLabel } from '@shared/providers/account-management'
import { consumeChatGptReset, readChatGptAllowance, tokenIdentity } from './chatgpt-allowance'

function jwt(claims: unknown): string {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`
}

it('reads the email and plan from the access token profile', () => {
  const identity = tokenIdentity(
    jwt({
      'https://api.openai.com/profile': { email: 'owner@example.com' },
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_fixture',
        chatgpt_plan_type: 'plus'
      }
    })
  )
  expect(identity).toEqual({
    accountId: 'acct_fixture',
    email: 'owner@example.com',
    plan: 'plus'
  })
  expect(chatGptPlanLabel(identity.plan ?? '')).toBe('ChatGPT Plus')
  expect(tokenIdentity(jwt({ workspace: { seat: { chatgpt_plan_type: 'pro' } } })).plan).toBe('pro')
  expect(chatGptPlanLabel('self_serve_business_prolite')).toBe('ChatGPT Business')
})

it('reads usage windows and the soonest reset card', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url.endsWith('/wham/usage')) {
      return Response.json({
        plan_type: 'plus',
        rate_limit: {
          primary_window: {
            used_percent: 100,
            limit_window_seconds: 18000,
            reset_after_seconds: 7200,
            reset_at: 1_800_000_000
          },
          secondary_window: {
            used_percent: 67,
            limit_window_seconds: 604800,
            reset_at: 1_900_000_000
          }
        },
        rate_limit_reset_credits: { available_count: 1 }
      })
    }
    return Response.json({
      available_count: 2,
      credits: [
        { id: 'card-later', status: 'available', expires_at: '2034-01-02T08:00:00Z' },
        { id: 'card-soon', status: 'available', expires_at: '2033-12-13T04:39:00Z' },
        { id: 'card-spent', status: 'redeemed', expires_at: '2030-01-01T00:00:00Z' }
      ]
    })
  })
  const allowance = await readChatGptAllowance(
    jwt({
      'https://api.openai.com/profile': { email: 'owner@example.com' },
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_fixture',
        chatgpt_plan_type: 'plus'
      }
    }),
    fetcher,
    AbortSignal.timeout(1000)
  )
  expect(allowance?.email).toBe('owner@example.com')
  expect(allowance?.plan).toBe('plus')
  expect(allowance?.windows.map((window) => [window.seconds, window.usedPercent])).toEqual([
    [18000, 100],
    [604800, 67]
  ])
  expect(allowance?.resets).toEqual({
    count: 2,
    expiresAt: Date.parse('2033-12-13T04:39:00Z'),
    cards: [
      { expiresAt: Date.parse('2033-12-13T04:39:00Z') },
      { expiresAt: Date.parse('2034-01-02T08:00:00Z') }
    ]
  })
  const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers)
  expect(headers.get('chatgpt-account-id')).toBe('acct_fixture')
  expect(headers.get('authorization')).toMatch(/^Bearer /)
})

it.each([
  ['reset', 'reset'],
  ['already_redeemed', 'alreadyRedeemed'],
  ['nothing_to_reset', 'nothingToReset'],
  ['no_credit', 'noCredit']
] as const)('lets the selected account choose a card and handles %s', async (code, outcome) => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ code }))
  const signal = new AbortController().signal
  await expect(consumeChatGptReset('fixture-access', fetcher, signal)).resolves.toBe(outcome)
  expect(fetcher).toHaveBeenCalledOnce()
  const [url, init] = fetcher.mock.calls[0]
  expect(String(url)).toMatch(/\/rate-limit-reset-credits\/consume$/)
  expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
  expect(JSON.parse(String(init?.body))).toEqual({
    redeem_request_id: expect.stringMatching(/^[a-f0-9-]{36}$/)
  })
  expect(new Headers(init?.headers).get('chatgpt-account-id')).toBeNull()
})

it('reports unsupported authorization or an unconfirmed debit without repeating the POST', async () => {
  const access = jwt({ chatgpt_account_id: 'workspace-a' })
  const signal = new AbortController().signal
  const refused = vi.fn<typeof fetch>(async () => new Response(null, { status: 403 }))
  await expect(consumeChatGptReset(access, refused, signal)).resolves.toBe('unavailable')
  expect(refused).toHaveBeenCalledOnce()
  expect(new Headers(refused.mock.calls[0]?.[1]?.headers).get('chatgpt-account-id')).toBe(
    'workspace-a'
  )
  const lost = vi.fn<typeof fetch>(async () => {
    throw new Error('connection lost')
  })
  await expect(consumeChatGptReset(access, lost, signal)).resolves.toBe('unconfirmed')
  expect(lost).toHaveBeenCalledOnce()
})

it('targets only an eligible card for the expiry rule', async () => {
  const now = Date.now()
  const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
    init?.method === 'POST'
      ? Response.json({ code: 'reset', windows_reset: 2 })
      : Response.json({
          credits: [
            { id: 'expired', status: 'available', expires_at: now - 60_000 },
            { id: 'later', status: 'available', expires_at: now + 10 * 60_000 },
            { id: 'soon', status: 'available', expires_at: now + 60_000 },
            { id: 'none', status: 'available' }
          ]
        })
  )
  const signal = new AbortController().signal
  await expect(
    consumeChatGptReset('fixture-access', fetcher, signal, undefined, now + 5 * 60_000)
  ).resolves.toBe('reset')
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ credit_id: 'soon' })
})
