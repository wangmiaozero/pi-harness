// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { chatGptPlanLabel } from '@shared/providers/account-management'
import { readChatGptAllowance, tokenIdentity } from './chatgpt-allowance'

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
  expect(headers.get('user-agent')).toMatch(/^codex_cli_rs\//)
})
