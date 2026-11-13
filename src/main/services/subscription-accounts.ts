import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { safeStorage } from 'electron'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { z } from 'zod'
import type { SubscriptionAccount } from '@shared/providers/account-management'
import { readBoundedJson } from './bounded-json'
import { ValidationError } from './errors'
import { atomicWriteJson, JsonStore, readTextFile } from './storage'
import { systemFetch, withSystemProxyFetch } from './system-fetch'

const claudeTokenUrl = 'https://platform.claude.com/v1/oauth/token'
const claudeProfileUrl = 'https://api.anthropic.com/api/oauth/profile'
const googleAuthorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
const googleTokenUrl = 'https://oauth2.googleapis.com/token'
const googleUserInfoUrl = 'https://www.googleapis.com/oauth2/v2/userinfo?alt=json'
const codeAssistUrl = 'https://cloudcode-pa.googleapis.com/v1internal:'
function geminiClient(): { id: string; secret: string } {
  const id = process.env.PI_HARNESS_GEMINI_CLIENT_ID?.trim() ?? ''
  const secret = process.env.PI_HARNESS_GEMINI_CLIENT_SECRET?.trim() ?? ''
  if (!id || !secret) {
    throw new ValidationError('Gemini sign-in is not configured', { reason: 'missing-client' })
  }
  return { id, secret }
}
const geminiScopes = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
]

type Provider = SubscriptionAccount['provider']
type AccountRecord = {
  provider: Provider
  email: string
  plan: string
  modelCount: number
  enabled: boolean
  expires: number
  published: boolean
  ciphertext: string
}
type AccountStore = { accounts: Record<string, AccountRecord> }

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive()
})
const profileSchema = z.object({
  email: z.string().optional(),
  account: z.object({ email: z.string().optional() }).optional()
})
const codeAssistSchema = z.object({
  currentTier: z.object({ name: z.string().optional(), id: z.string().optional() }).nullish(),
  paidTier: z.object({ name: z.string().optional(), id: z.string().optional() }).nullish(),
  cloudaicompanionProject: z.union([z.string(), z.object({ id: z.string().optional() })]).optional()
})
const quotaSchema = z.object({
  buckets: z
    .array(z.object({ modelId: z.string().optional() }))
    .max(500)
    .optional()
})

function geminiUserAgent(): string {
  const platform =
    process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : 'darwin'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return `GeminiCLI/0.61.0/gemini-2.5-pro (${platform}; ${arch}; terminal)`
}

function projectId(value: z.infer<typeof codeAssistSchema>['cloudaicompanionProject']): string {
  if (typeof value === 'string') return value
  return value?.id ?? ''
}

export class SubscriptionAccounts {
  private readonly store: JsonStore<AccountStore>
  private login: AbortController | null = null

  constructor(
    file: string,
    private readonly authPath: () => string
  ) {
    this.store = new JsonStore(file, { accounts: {} })
  }

  async list(): Promise<SubscriptionAccount[]> {
    const { accounts } = await this.store.read()
    return Object.entries(accounts).map(([id, record]) => ({
      id,
      provider: record.provider,
      email: record.email,
      plan: record.plan,
      modelCount: record.modelCount,
      enabled: record.enabled,
      status: record.expires > Date.now() ? 'authorized' : 'expired'
    }))
  }

  async connect(
    provider: Provider,
    openAuthorization: (url: string) => Promise<void>,
    onExchange?: () => void
  ): Promise<void> {
    if (this.login) throw new ValidationError('Sign-in is already in progress')
    this.assertStorage()
    const controller = new AbortController()
    this.login = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(3 * 60_000)])
    try {
      if (Object.keys((await this.store.read()).accounts).length >= 20)
        throw new ValidationError('Subscription account limit reached')
      const account =
        provider === 'claude'
          ? await this.connectClaude(openAuthorization, onExchange, signal)
          : await this.connectGemini(openAuthorization, onExchange, signal)
      signal.throwIfAborted()
      const id = `${provider}-account-${randomUUID()}`
      const published =
        provider === 'claude' &&
        (await this.publishClaude(this.decrypt(account.ciphertext), id).catch(() => false))
      await this.store.mutate({
        apply: (current) => ({
          ...current,
          accounts: {
            ...current.accounts,
            [id]: { ...account, published }
          }
        })
      })
    } catch (error) {
      if (signal.aborted) {
        throw new ValidationError('Sign-in did not complete', {
          reason: signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled'
        })
      }
      if (error instanceof ValidationError) throw error
      throw new ValidationError('Sign-in did not complete', { reason: 'rejected' })
    } finally {
      this.login = null
    }
  }

  cancel(): void {
    this.login?.abort()
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const current = (await this.store.read()).accounts[id]
    if (!current) throw new ValidationError('Subscription account was not found')
    let published = current.published
    if (current.provider === 'claude' && current.published && !enabled) {
      await this.unpublishClaude(this.decrypt(current.ciphertext).refresh)
      published = false
    }
    if (current.provider === 'claude' && enabled) {
      published = await this.publishClaude(this.decrypt(current.ciphertext), id).catch(() => false)
    }
    await this.store.mutate({
      apply: (store) => {
        const record = store.accounts[id]
        if (!record) return store
        return {
          ...store,
          accounts: { ...store.accounts, [id]: { ...record, enabled, published } }
        }
      }
    })
  }

  async disconnect(id: string): Promise<void> {
    const current = (await this.store.read()).accounts[id]
    if (!current) return
    if (current.provider === 'claude' && current.published)
      await this.unpublishClaude(this.decrypt(current.ciphertext).refresh)
    await this.store.mutate({
      apply: (store) => {
        const accounts = { ...store.accounts }
        delete accounts[id]
        return { ...store, accounts }
      }
    })
  }

  private async connectClaude(
    openAuthorization: (url: string) => Promise<void>,
    onExchange: (() => void) | undefined,
    signal: AbortSignal
  ): Promise<AccountRecord> {
    const { anthropicProvider } = await import('@earendil-works/pi-ai/providers/anthropic')
    const provider = anthropicProvider()
    let reported = false
    const credential = await withSystemProxyFetch(
      () =>
        provider.auth.oauth!.login({
          signal,
          notify: (event) => {
            if (event.type === 'progress') {
              if (!reported) {
                reported = true
                onExchange?.()
              }
              return
            }
            if (event.type !== 'auth_url') return
            const url = URL.parse(event.url)
            if (url?.origin !== 'https://claude.ai' || url.pathname !== '/oauth/authorize') {
              this.login?.abort()
              return
            }
            void openAuthorization(event.url).catch(() => this.login?.abort())
          },
          prompt: (prompt) =>
            prompt.type === 'select'
              ? Promise.resolve('browser')
              : new Promise<never>((_, reject) => {
                  const cancel = () => reject(new Error('Authorization ended'))
                  if (signal.aborted) cancel()
                  else signal.addEventListener('abort', cancel, { once: true })
                })
        }),
      claudeTokenUrl
    )
    const email = await this.claudeEmail(credential.access, signal)
    return {
      provider: 'claude',
      email,
      plan: '',
      modelCount: provider.getModels().length,
      enabled: true,
      expires: credential.expires,
      published: false,
      ciphertext: this.encrypt(credential)
    }
  }

  private async claudeEmail(access: string, signal: AbortSignal): Promise<string> {
    try {
      const response = await systemFetch(claudeProfileUrl, {
        headers: { authorization: `Bearer ${access}`, accept: 'application/json' },
        redirect: 'error',
        signal
      })
      if (!response.ok) {
        await response.body?.cancel()
        return ''
      }
      const profile = profileSchema.parse(await readBoundedJson(response, 16_384))
      return profile.email || profile.account?.email || ''
    } catch {
      return ''
    }
  }

  private async connectGemini(
    openAuthorization: (url: string) => Promise<void>,
    onExchange: (() => void) | undefined,
    signal: AbortSignal
  ): Promise<AccountRecord> {
    const client = geminiClient()
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(24).toString('base64url')
    const callback = await this.geminiCallback(state, signal)
    try {
      const redirect = `http://127.0.0.1:${callback.port}/oauth2callback`
      const query = new URLSearchParams({
        client_id: client.id,
        redirect_uri: redirect,
        response_type: 'code',
        scope: geminiScopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
      })
      const url = `${googleAuthorizeUrl}?${query}`
      void callback.code.catch(() => {})
      await openAuthorization(url)
      const code = await callback.code
      onExchange?.()
      const exchanged = await systemFetch(googleTokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirect,
          client_id: client.id,
          client_secret: client.secret,
          code_verifier: verifier
        }),
        redirect: 'error',
        signal
      })
      if (!exchanged.ok) {
        await exchanged.body?.cancel()
        throw new ValidationError('Sign-in did not complete', {
          reason: 'rejected',
          status: exchanged.status
        })
      }
      const token = tokenSchema.parse(await readBoundedJson(exchanged, 16_384))
      const who = await systemFetch(googleUserInfoUrl, {
        headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/json' },
        redirect: 'error',
        signal
      })
      if (!who.ok) {
        await who.body?.cancel()
        throw new ValidationError('Sign-in did not complete', {
          reason: 'rejected',
          status: who.status
        })
      }
      const email = z
        .object({ email: z.string().trim().min(3).max(320) })
        .parse(await readBoundedJson(who, 16_384)).email
      const allowance = await this.geminiAllowance(token.access_token, signal)
      const credential: OAuthCredential = {
        type: 'oauth',
        access: token.access_token,
        refresh: token.refresh_token,
        expires: Date.now() + token.expires_in * 1000
      }
      return {
        provider: 'gemini',
        email,
        plan: allowance.plan,
        modelCount: allowance.modelCount,
        enabled: true,
        expires: credential.expires,
        published: false,
        ciphertext: this.encrypt(credential)
      }
    } finally {
      await callback.close()
    }
  }

  private geminiCallback(state: string, signal: AbortSignal) {
    const server = createServer()
    let resolveCode: (code: string) => void = () => {}
    let rejectCode: (error: Error) => void = () => {}
    const code = new Promise<string>((resolve, reject) => {
      resolveCode = resolve
      rejectCode = reject
    })
    const abort = () => rejectCode(new Error('Authorization ended'))
    signal.addEventListener('abort', abort, { once: true })
    server.on('request', (request, response) => {
      let url: URL
      try {
        url = new URL(request.url ?? '/', 'http://127.0.0.1')
      } catch {
        response.writeHead(400).end()
        return
      }
      if (url.pathname !== '/oauth2callback') {
        response.writeHead(404).end()
        return
      }
      const received = url.searchParams.get('code')
      if (url.searchParams.get('state') !== state || !received) {
        response.writeHead(400).end('Authorization did not match this sign-in.')
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><title>Gemini CLI</title><p>You can close this window.</p>')
      resolveCode(received)
    })
    return new Promise<{ port: number; code: Promise<string>; close: () => Promise<void> }>(
      (resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          const address = server.address() as AddressInfo
          resolve({
            port: address.port,
            code,
            close: () =>
              new Promise((done) => {
                server.close(() => done())
              })
          })
        })
      }
    )
  }

  private async geminiAllowance(
    access: string,
    signal: AbortSignal
  ): Promise<{ plan: string; modelCount: number }> {
    try {
      const headers = {
        authorization: `Bearer ${access}`,
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': geminiUserAgent()
      }
      const loaded = await systemFetch(`${codeAssistUrl}loadCodeAssist`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI'
          }
        }),
        redirect: 'error',
        signal
      })
      if (!loaded.ok) {
        await loaded.body?.cancel()
        return { plan: '', modelCount: 0 }
      }
      const assist = codeAssistSchema.parse(await readBoundedJson(loaded, 65_536))
      const plan =
        assist.paidTier?.name ||
        assist.currentTier?.name ||
        assist.paidTier?.id ||
        assist.currentTier?.id ||
        ''
      const project = projectId(assist.cloudaicompanionProject)
      if (!project) return { plan, modelCount: 0 }
      const quota = await systemFetch(`${codeAssistUrl}retrieveUserQuota`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ project }),
        redirect: 'error',
        signal
      })
      if (!quota.ok) {
        await quota.body?.cancel()
        return { plan, modelCount: 0 }
      }
      const buckets = quotaSchema.parse(await readBoundedJson(quota, 65_536)).buckets ?? []
      return {
        plan,
        modelCount: new Set(buckets.map((bucket) => bucket.modelId).filter(Boolean)).size
      }
    } catch {
      return { plan: '', modelCount: 0 }
    }
  }

  private async publishClaude(credential: OAuthCredential, owner: string): Promise<boolean> {
    const file = this.authPath()
    const raw = await readTextFile(file)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const data = parsed as Record<string, unknown>
    const current = data.anthropic
    if (current && typeof current === 'object' && (current as { type?: string }).type === 'api_key')
      return false
    const accounts = { ...(await this.store.read()).accounts }
    for (const [id, record] of Object.entries(accounts)) {
      if (id !== owner && record.provider === 'claude' && record.published) {
        await this.unpublishClaude(this.decrypt(record.ciphertext).refresh)
        record.published = false
      }
    }
    data.anthropic = {
      type: 'oauth',
      access: credential.access,
      refresh: credential.refresh,
      expires: credential.expires
    }
    await atomicWriteJson(file, data)
    if (owner) {
      await this.store.mutate({
        apply: (store) => ({ ...store, accounts })
      })
    }
    return true
  }

  private async unpublishClaude(refresh: string): Promise<void> {
    const file = this.authPath()
    const raw = await readTextFile(file)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const data = parsed as Record<string, unknown>
    const current = data.anthropic
    if (
      !current ||
      typeof current !== 'object' ||
      (current as { type?: string }).type !== 'oauth' ||
      (current as { refresh?: string }).refresh !== refresh
    )
      return
    delete data.anthropic
    await atomicWriteJson(file, data)
  }

  private assertStorage(): void {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new ValidationError('Secure credential storage is unavailable')
  }

  private encrypt(credential: OAuthCredential): string {
    this.assertStorage()
    return safeStorage.encryptString(JSON.stringify(credential)).toString('base64')
  }

  private decrypt(ciphertext: string): OAuthCredential {
    this.assertStorage()
    return JSON.parse(safeStorage.decryptString(Buffer.from(ciphertext, 'base64')))
  }
}
