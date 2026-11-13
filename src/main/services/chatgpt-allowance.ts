import { z } from 'zod'
import type { ChatGptAllowance } from '@shared/providers/account-management'
import { readBoundedJson } from './bounded-json'
import { log } from './logger'
import { systemFetch } from './system-fetch'

const usageUrl = 'https://chatgpt.com/backend-api/wham/usage'
const creditsUrl = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'
const consumeUrl = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume'
const accountsUrl = 'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27'

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
  rate_limit_reset_credits: z.object({ available_count: z.number().int().optional() }).optional()
})
const creditSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  expires_at: z.union([z.string(), z.number()]).nullable().optional()
})
const creditsSchema = z.object({
  available_count: z.number().int().optional(),
  credits: z.array(creditSchema).max(100).optional()
})
const consumeSchema = z.object({ code: z.string() })

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

export function codexUserAgent(): string {
  const os =
    process.platform === 'darwin'
      ? 'Mac OS 15.0.0'
      : process.platform === 'win32'
        ? 'Windows 10.0.26100'
        : 'Linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  const term =
    process.platform === 'darwin'
      ? 'Apple_Terminal/455'
      : process.platform === 'win32'
        ? 'WindowsTerminal'
        : 'xterm-256color'
  return `codex_cli_rs/0.98.0 (${os}; ${arch}) ${term}`
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

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** Account calls keep the Codex user agent. The default Electron fetch replaces that header. */
export async function codexAccountFetch(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit
): Promise<Response> {
  const url = requestUrl(input)
  try {
    const { session } = await import('electron')
    if (typeof session?.fromPartition !== 'function') return systemFetch(url, init)
    const partition = session.fromPartition('chatgpt-account', { cache: false })
    partition.setUserAgent(codexUserAgent())
    if (typeof partition.setProxy === 'function') {
      const resolved = await session.defaultSession.resolveProxy(url).catch(() => '')
      const proxy = /^(?:PROXY|HTTPS)\s+(\S+)/.exec(resolved.split(';')[0]?.trim() ?? '')
      await partition.setProxy(
        proxy
          ? {
              mode: 'fixed_servers',
              proxyRules: `http://${proxy[1]}`,
              proxyBypassRules: '<-loopback>'
            }
          : { mode: 'system' }
      )
    }
    return partition.fetch(url, init)
  } catch (error) {
    log.provider.warn('ChatGPT account request fell back to the system fetch', {
      reason: error instanceof Error ? error.name : 'unknown'
    })
    return systemFetch(url, init)
  }
}

function headers(access: string, accountId: string): HeadersInit {
  return {
    authorization: `Bearer ${access}`,
    accept: 'application/json',
    originator: 'codex_cli_rs',
    'user-agent': codexUserAgent(),
    'chatgpt-account-id': accountId
  }
}

function blankAllowance(identity: { email?: string; plan?: string }): ChatGptAllowance {
  return { email: identity.email, plan: identity.plan ?? '', windows: [], resets: { count: 0 } }
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`ChatGPT allowance HTTP ${response.status}`)
  return readBoundedJson(response, 65_536)
}

export async function readChatGptAllowance(
  access: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  idToken?: string,
  accountIdHint?: string
): Promise<ChatGptAllowance | null> {
  const identity = identityFrom(access, idToken)
  let accountId = identity.accountId ?? accountIdHint
  if (!accountId) {
    const checked = await fetchImpl(accountsUrl, {
      headers: {
        authorization: `Bearer ${access}`,
        accept: 'application/json',
        originator: 'codex_cli_rs',
        'user-agent': codexUserAgent()
      },
      redirect: 'error',
      signal
    })
    if (!checked.ok) {
      log.provider.warn('ChatGPT account check failed', { status: checked.status })
      return identity.email || identity.plan ? blankAllowance(identity) : null
    }
    const body = z
      .object({
        accounts: z.record(
          z.string(),
          z
            .object({
              account: z
                .object({
                  account_id: z.string().optional(),
                  plan_type: z.string().optional()
                })
                .optional()
            })
            .passthrough()
        )
      })
      .safeParse(await readBoundedJson(checked, 65_536))
    const first = body.success ? Object.entries(body.data.accounts)[0] : undefined
    accountId = first?.[1].account?.account_id ?? first?.[0]
    identity.plan ??= first?.[1].account?.plan_type
  }
  if (!accountId) return identity.email || identity.plan ? blankAllowance(identity) : null
  let usage: z.infer<typeof usageSchema>
  try {
    usage = usageSchema.parse(
      await readJson(
        await fetchImpl(usageUrl, {
          headers: headers(access, accountId),
          redirect: 'error',
          signal
        })
      )
    )
  } catch (error) {
    log.provider.warn('ChatGPT allowance was not read', {
      status: error instanceof Error ? error.message : 'unknown'
    })
    return identity.email || identity.plan ? blankAllowance(identity) : null
  }
  const credits = await readJson(
    await fetchImpl(creditsUrl, { headers: headers(access, accountId), redirect: 'error', signal })
  )
    .then((body) => creditsSchema.parse(body))
    .catch(() => ({
      available_count: usage.rate_limit_reset_credits?.available_count,
      credits: []
    }))
  const windows = [usage.rate_limit?.primary_window, usage.rate_limit?.secondary_window].flatMap(
    (window) =>
      window?.limit_window_seconds
        ? [
            {
              seconds: window.limit_window_seconds,
              usedPercent: Math.min(100, Math.max(0, window.used_percent ?? 0)),
              resetAt: window.reset_at
                ? window.reset_at * 1000
                : window.reset_after_seconds
                  ? Date.now() + window.reset_after_seconds * 1000
                  : undefined
            }
          ]
        : []
  )
  const soonest = (credits.credits ?? [])
    .filter((credit) => credit.status === 'available')
    .map((credit) => creditExpiry(credit.expires_at))
    .filter((time): time is number => time !== undefined)
    .sort((a, b) => a - b)[0]
  return {
    email: identity.email,
    plan: usage.plan_type || identity.plan || '',
    windows,
    resets: {
      count: credits.available_count ?? usage.rate_limit_reset_credits?.available_count ?? 0,
      expiresAt: soonest
    }
  }
}

export async function consumeChatGptReset(
  access: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  idToken?: string
): Promise<boolean> {
  const identity = identityFrom(access, idToken)
  const accountId = identity.accountId
  if (!accountId) return false
  const listed = creditsSchema.parse(
    await readJson(
      await fetchImpl(creditsUrl, {
        headers: headers(access, accountId),
        redirect: 'error',
        signal
      })
    )
  )
  const credit = (listed.credits ?? [])
    .filter((item) => item.status === 'available' && item.id)
    .sort((a, b) => {
      const left = creditExpiry(a.expires_at) ?? Number.POSITIVE_INFINITY
      const right = creditExpiry(b.expires_at) ?? Number.POSITIVE_INFINITY
      return left - right
    })[0]
  if (!credit?.id) return false
  const consumed = consumeSchema.parse(
    await readJson(
      await fetchImpl(consumeUrl, {
        method: 'POST',
        headers: { ...headers(access, accountId), 'content-type': 'application/json' },
        body: JSON.stringify({ credit_id: credit.id, redeem_request_id: crypto.randomUUID() }),
        redirect: 'error',
        signal
      })
    )
  )
  return consumed.code === 'reset'
}
