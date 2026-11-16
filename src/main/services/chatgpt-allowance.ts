import { z } from 'zod'
import type { ChatGptAllowance, ChatGptResetOutcome } from '@shared/providers/account-management'
import { readBoundedJson } from './bounded-json'
import { log } from './logger'

const usageUrl = 'https://chatgpt.com/backend-api/wham/usage'
const creditsUrl = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'
const consumeUrl = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume'

const windowSchema = z.object({
  used_percent: z.number().nullish(),
  limit_window_seconds: z.number().nullish(),
  reset_after_seconds: z.number().nullish(),
  reset_at: z.number().nullish()
})
const usageSchema = z.object({
  plan_type: z.string().nullish(),
  rate_limit: z
    .object({
      primary_window: windowSchema.nullish(),
      secondary_window: windowSchema.nullish()
    })
    .optional(),
  rate_limit_reset_credits: z
    .object({ available_count: z.number().int().nonnegative().optional() })
    .optional()
})
const creditSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  expires_at: z.union([z.string(), z.number()]).nullable().optional()
})
const creditsSchema = z.object({
  available_count: z.number().int().nonnegative().optional(),
  credits: z.array(creditSchema).max(100).optional()
})
const consumeSchema = z.object({
  code: z.enum(['reset', 'already_redeemed', 'nothing_to_reset', 'no_credit']),
  windows_reset: z.number().int().nonnegative().optional()
})

export type ResetScope = 'off' | 'week' | 'both'

function claimString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function findClaim(value: unknown, key: string, depth = 0): string | undefined {
  if (depth > 6 || !value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findClaim(item, key, depth + 1)
      if (found) return found
    }
    return
  }
  const record = value as Record<string, unknown>
  const direct = claimString(record[key])
  if (direct) return direct
  for (const child of Object.values(record)) {
    const found = findClaim(child, key, depth + 1)
    if (found) return found
  }
  return
}

export function tokenIdentity(access: string): {
  accountId?: string
  email?: string
  plan?: string
} {
  const part = access.split('.')[1]
  if (!part) return {}
  try {
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown
    return {
      accountId: findClaim(claims, 'chatgpt_account_id'),
      email: findClaim(claims, 'email'),
      plan: findClaim(claims, 'chatgpt_plan_type')
    }
  } catch {
    return {}
  }
}

function identityFrom(
  access: string,
  idToken?: string
): {
  accountId?: string
  email?: string
  plan?: string
} {
  const named = idToken ? tokenIdentity(idToken) : {}
  const session = tokenIdentity(access)
  return {
    accountId: named.accountId ?? session.accountId,
    email: named.email ?? session.email,
    plan: named.plan ?? session.plan
  }
}

export function quotaExhausted(
  scope: ResetScope,
  windows: readonly { seconds: number; usedPercent: number }[]
): boolean {
  if (scope === 'off' || !windows.length) return false
  const week = [...windows].sort((a, b) => b.seconds - a.seconds)[0]
  if (scope === 'week') return week.seconds >= 24 * 60 * 60 && week.usedPercent >= 100
  return windows.some((window) => window.usedPercent >= 100)
}

function creditExpiry(value: string | number | null | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000
  }
  if (typeof value !== 'string' || !value) return
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function headers(access: string, accountId?: string): HeadersInit {
  return {
    authorization: `Bearer ${access}`,
    accept: 'application/json',
    ...(accountId ? { 'chatgpt-account-id': accountId } : {})
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`ChatGPT allowance HTTP ${response.status}`)
  return readBoundedJson(response, 65_536)
}

export async function readChatGptAllowance(
  access: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  idToken?: string
): Promise<ChatGptAllowance | null> {
  const identity = identityFrom(access, idToken)
  const readOptions: RequestInit = {
    headers: headers(access, identity.accountId),
    redirect: 'error',
    cache: 'no-store',
    signal
  }
  const [usage, credits] = await Promise.all([
    fetchImpl(usageUrl, readOptions)
      .then(readJson)
      .then((body) => usageSchema.parse(body))
      .catch(() => null),
    fetchImpl(creditsUrl, readOptions)
      .then(readJson)
      .then((body) => creditsSchema.parse(body))
      .catch(() => null)
  ])
  if (!usage && !credits && !identity.email && !identity.plan) return null
  const windows = [usage?.rate_limit?.primary_window, usage?.rate_limit?.secondary_window].flatMap(
    (window) =>
      window?.limit_window_seconds && window.used_percent != null
        ? [
            {
              seconds: window.limit_window_seconds,
              usedPercent: Math.min(100, Math.max(0, window.used_percent)),
              resetAt: window.reset_at
                ? window.reset_at * 1000
                : window.reset_after_seconds
                  ? Date.now() + window.reset_after_seconds * 1000
                  : undefined
            }
          ]
        : []
  )
  const cards = (credits?.credits ?? [])
    .filter((credit) => credit.status === 'available')
    .map((credit) => ({ expiresAt: creditExpiry(credit.expires_at) }))
    .sort(
      (left, right) =>
        (left.expiresAt ?? Number.POSITIVE_INFINITY) - (right.expiresAt ?? Number.POSITIVE_INFINITY)
    )
  const count =
    credits?.available_count ??
    usage?.rate_limit_reset_credits?.available_count ??
    (credits?.credits ? cards.length : undefined)
  return {
    email: identity.email,
    plan: usage?.plan_type || identity.plan || '',
    windows,
    resets: {
      count: count ?? 0,
      ...(count === undefined ? { unavailable: true } : {}),
      expiresAt: cards.find((card) => card.expiresAt)?.expiresAt,
      cards
    }
  }
}

export async function consumeChatGptReset(
  access: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  idToken?: string,
  expiringBefore?: number
): Promise<ChatGptResetOutcome> {
  const requestHeaders = headers(access, identityFrom(access, idToken).accountId)
  let creditId: string | undefined
  try {
    // A manual reset lets the service pick the next card. Expiry rules must name a card
    // that actually qualifies for the rule.
    if (expiringBefore !== undefined) {
      const listed = creditsSchema.parse(
        await readJson(
          await fetchImpl(creditsUrl, {
            headers: requestHeaders,
            redirect: 'error',
            cache: 'no-store',
            signal
          })
        )
      )
      const now = Date.now()
      creditId = (listed.credits ?? [])
        .flatMap((card) => {
          const expiresAt = creditExpiry(card.expires_at)
          return card.status === 'available' &&
            card.id &&
            expiresAt &&
            expiresAt > now &&
            expiresAt <= expiringBefore
            ? [{ id: card.id, expiresAt }]
            : []
        })
        .sort((a, b) => a.expiresAt - b.expiresAt)[0]?.id
      if (!creditId) return 'noCredit'
    }

    const response = await fetchImpl(consumeUrl, {
      method: 'POST',
      headers: { ...requestHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ redeem_request_id: crypto.randomUUID(), credit_id: creditId }),
      redirect: 'error',
      signal
    })
    if ([401, 403, 404].includes(response.status)) return 'unavailable'
    const { code, windows_reset } = consumeSchema.parse(await readJson(response))
    switch (code) {
      case 'reset':
        return windows_reset === 0 ? 'unconfirmed' : 'reset'
      case 'already_redeemed':
        return 'alreadyRedeemed'
      case 'nothing_to_reset':
        return 'nothingToReset'
      case 'no_credit':
        return 'noCredit'
    }
  } catch (error) {
    // A failed response can follow a successful debit. Never send another POST here.
    log.provider.warn('ChatGPT reset result could not be confirmed', {
      reason: error instanceof Error ? error.name : 'unknown'
    })
    return 'unconfirmed'
  }
}
