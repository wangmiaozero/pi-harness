import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { z } from 'zod'
import {
  CHATGPT_MODEL_ID,
  CHATGPT_PROVIDER_PREFIX,
  type ChatGptAccount,
  type ChatGptModelSelection,
  type ChatGptRoutingMode
} from '@shared/providers/account-management'
import { readBoundedJson } from './bounded-json'
import { AppError, ValidationError } from './errors'
import { JsonStore } from './storage'
import { OAuthExchangeError, systemFetch, withSystemProxyFetch } from './system-fetch'

type AccountRecord = {
  label: string
  ciphertext: string
  expires: number
  verified: string[]
  lastUsedAt?: number
  disabled?: string[]
  catalog?: { models: { id: string; name: string }[]; updatedAt: number }
}

type AccountStore = {
  deviceId: string | null
  accounts: Record<string, AccountRecord>
  defaultModel?: ChatGptModelSelection
  fallbackAccountIds?: string[]
  routingMode?: ChatGptRoutingMode
}

const origin = 'https://auth.openai.com'
const catalogEndpoint = 'https://api.openai.com/v1/models'
const catalogSchema = z.object({
  models: z
    .array(
      z.object({
        slug: z.string(),
        display_name: z.string().nullish(),
        visibility: z.string()
      })
    )
    .max(1000)
})

function permitsModel(account: AccountRecord, modelId: string): boolean {
  return (
    (!account.catalog || account.catalog.models.some(({ id }) => id === modelId)) &&
    !account.disabled?.includes(modelId)
  )
}
const defaults: AccountStore = { deviceId: null, accounts: {} }
const credentialError = () =>
  new AppError('VALIDATION_ERROR', 'ChatGPT authorization is unavailable. Reconnect your account.')

let openAI:
  | Promise<ReturnType<typeof import('@earendil-works/pi-ai/providers/openai').openaiProvider>>
  | undefined

function loadOpenAI() {
  return (openAI ??= import('@earendil-works/pi-ai/providers/openai').then(({ openaiProvider }) =>
    openaiProvider()
  ))
}

export class ChatGptAccounts {
  private readonly store: JsonStore<AccountStore>
  private readonly shutdown = new AbortController()
  private readonly operations = new Map<string, Promise<unknown>>()
  private loginController: AbortController | null = null
  private readonly catalogRefreshes = new Map<string, Promise<void>>()
  private readonly catalogFailures = new Set<string>()
  private rotation = { pool: '', next: 0 }

  constructor(file: string) {
    this.store = new JsonStore(file, defaults)
  }

  async list(): Promise<ChatGptAccount[]> {
    const { accounts, defaultModel, fallbackAccountIds, routingMode } = await this.store.read()
    if (!Object.keys(accounts).length) return []
    const [provider, { getSupportedThinkingLevels }] = await Promise.all([
      loadOpenAI(),
      import('@earendil-works/pi-ai')
    ])
    const native = new Map(provider.getModels().map((model) => [model.id, model]))
    return Object.entries(accounts).map(([id, record]) => ({
      id,
      label: record.label,
      status: record.expires > Date.now() ? 'authorized' : 'expired',
      lastUsedAt: record.lastUsedAt,
      catalogUpdatedAt: record.catalog?.updatedAt,
      catalogFailed: this.catalogFailures.has(id),
      defaultModelId: defaultModel?.id === id ? defaultModel.modelId : undefined,
      routingMode: defaultModel?.id === id ? (routingMode ?? 'ordered') : undefined,
      fallbackRank: (fallbackAccountIds?.indexOf(id) ?? -1) + 1 || undefined,
      models: (record.catalog?.models ?? [...native.values()]).map(({ id: modelId, name }) => {
        const model = native.get(modelId)
        return {
          id: modelId,
          name,
          reasoning: model?.reasoning ?? false,
          vision: model?.input.includes('image') ?? false,
          contextWindow: model?.contextWindow,
          maxOutputTokens: model?.maxTokens,
          thinkingLevels: model?.reasoning ? getSupportedThinkingLevels(model) : undefined,
          verified: record.verified.includes(modelId),
          disabled: record.disabled?.includes(modelId),
          unsupported: !model
        }
      })
    }))
  }

  async connect(
    openAuthorization: (url: string) => Promise<void>,
    onExchange?: () => void
  ): Promise<void> {
    if (this.loginController) throw new ValidationError('ChatGPT sign-in is already in progress')
    const callbackHost = process.env.PI_OAUTH_CALLBACK_HOST
    if (callbackHost && callbackHost !== '127.0.0.1')
      throw new ValidationError('ChatGPT authorization requires a loopback callback')
    this.assertStorage()
    const controller = new AbortController()
    this.loginController = controller
    const signal = AbortSignal.any([
      this.shutdown.signal,
      controller.signal,
      AbortSignal.timeout(3 * 60_000)
    ])
    let phase = 'prepare'
    try {
      const state = await this.store.mutate({
        apply: (current) => {
          if (Object.keys(current.accounts).length >= 20)
            throw new ValidationError('ChatGPT account limit reached')
          return { ...current, deviceId: current.deviceId ?? randomUUID() }
        }
      })
      const oauth = (await loadOpenAI()).auth.oauth!
      phase = 'authorize'
      let reported = false
      const credential = await withSystemProxyFetch(() =>
        oauth.login(
          {
            signal,
            notify: (event) => {
              if (event.type === 'progress') {
                if (!reported) {
                  reported = true
                  phase = 'exchange'
                  onExchange?.()
                }
                return
              }
              if (event.type !== 'auth_url') return
              const url = URL.parse(event.url)
              if (
                url?.origin !== origin ||
                url.pathname !== '/api/accounts/authorize' ||
                url.username ||
                url.password
              ) {
                controller.abort()
                return
              }
              void openAuthorization(event.url).catch(() => controller.abort())
            },
            // Only the SDK's state-checked loopback callback is accepted.
            prompt: ({ signal: promptSignal }) =>
              new Promise((_, reject) => {
                const combined = AbortSignal.any([signal, ...(promptSignal ? [promptSignal] : [])])
                const cancel = () => reject(new Error('Authorization ended'))
                if (combined.aborted) cancel()
                else combined.addEventListener('abort', cancel, { once: true })
              })
          },
          { agentName: 'Pi-Harness', getDeviceId: () => state.deviceId! }
        )
      )
      signal.throwIfAborted()
      phase = 'save'
      const id = CHATGPT_PROVIDER_PREFIX + randomUUID()
      const record: AccountRecord = {
        label: id.slice(-8),
        expires: credential.expires,
        ciphertext: this.encrypt(credential),
        verified: []
      }
      await this.store.mutate({
        apply: (current) => ({ ...current, accounts: { ...current.accounts, [id]: record } })
      })
      await this.refreshCatalog(id).catch(() => {})
    } catch (error) {
      if (signal.aborted) {
        throw new ValidationError('ChatGPT sign-in did not complete', {
          reason: signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled'
        })
      }
      const failure = error instanceof OAuthExchangeError ? error : undefined
      throw new ValidationError('ChatGPT sign-in did not complete', {
        phase,
        reason: failure?.reason ?? phase,
        status: failure?.status,
        upstreamCode: failure?.upstreamCode
      })
    } finally {
      this.loginController = null
    }
  }

  cancelLogin(): void {
    this.loginController?.abort()
  }

  close(): void {
    this.shutdown.abort()
  }

  async hasVerifiedModel(id: string, modelId: string): Promise<boolean> {
    const account = (await this.store.read()).accounts[id]
    return !!account && permitsModel(account, modelId) && account.verified.includes(modelId)
  }

  refreshCatalog(id: string): Promise<void> {
    const existing = this.catalogRefreshes.get(id)
    if (existing) return existing
    const request = this.serial(id, async () => {
      const account = (await this.store.read()).accounts[id]
      if (!account) throw credentialError()
      const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(15_000)])
      try {
        const apiKey = await this.accessToken(id, signal)
        const response = await systemFetch(catalogEndpoint, {
          headers: { authorization: `Bearer ${apiKey}` },
          redirect: 'error',
          signal
        })
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error('Model catalog request failed')
        }
        const value = catalogSchema.parse(await readBoundedJson(response, 512 * 1024))
        const unique = new Map<string, string>()
        for (const model of value.models) {
          if (
            model.visibility !== 'list' ||
            !CHATGPT_MODEL_ID.test(model.slug) ||
            model.slug.includes(apiKey) ||
            unique.has(model.slug)
          )
            continue
          const label = model.display_name?.includes(apiKey) ? undefined : model.display_name
          unique.set(model.slug, label?.trim().slice(0, 160) || model.slug)
        }
        const models = [...unique].map(([id, name]) => ({ id, name }))
        await this.store.mutate({
          apply: (current) => {
            const account = current.accounts[id]
            if (!account) throw credentialError()
            return {
              ...current,
              accounts: {
                ...current.accounts,
                [id]: { ...account, catalog: { models, updatedAt: Date.now() } }
              }
            }
          }
        })
        this.catalogFailures.delete(id)
      } catch {
        this.catalogFailures.add(id)
        throw new ValidationError('ChatGPT could not refresh the account model catalog')
      }
    }).finally(() => this.catalogRefreshes.delete(id))
    this.catalogRefreshes.set(id, request)
    return request
  }

  async setModelEnabled(id: string, modelId: string, enabled: boolean): Promise<void> {
    await this.serial(id, () =>
      this.store.mutate({
        apply: (current) => {
          const account = current.accounts[id]
          if (!account?.verified.includes(modelId)) throw credentialError()
          const disabled = new Set(account.disabled)
          if (enabled) disabled.delete(modelId)
          else disabled.add(modelId)
          return {
            ...current,
            accounts: {
              ...current.accounts,
              [id]: { ...account, disabled: [...disabled] }
            }
          }
        }
      })
    )
  }

  async setLabel(id: string, label: string): Promise<void> {
    await this.store.mutate({
      apply: (current) => {
        const account = current.accounts[id]
        if (!account) throw credentialError()
        return { ...current, accounts: { ...current.accounts, [id]: { ...account, label } } }
      }
    })
  }

  async setDefaultModel(defaultModel: ChatGptModelSelection | null): Promise<void> {
    await this.store.mutate({
      apply: (current) => {
        if (!defaultModel)
          return {
            ...current,
            defaultModel: undefined,
            fallbackAccountIds: [],
            routingMode: undefined
          }
        const { id, modelId } = defaultModel
        const account = current.accounts[id]
        if (!account || !account.verified.includes(modelId) || !permitsModel(account, modelId))
          throw new ValidationError('Select a verified and enabled ChatGPT model')
        if (current.defaultModel?.id === id && current.defaultModel.modelId === modelId)
          return current
        return { ...current, defaultModel, fallbackAccountIds: [], routingMode: undefined }
      }
    })
    this.rotation = { pool: '', next: 0 }
  }

  async setRoutingMode(routingMode: ChatGptRoutingMode): Promise<void> {
    await this.store.mutate({
      apply: (current) => {
        if (!current.defaultModel || !current.fallbackAccountIds?.length)
          throw new ValidationError('Add an allowed fallback account before changing routing')
        return { ...current, routingMode }
      }
    })
    this.rotation = { pool: '', next: 0 }
  }

  async setFallbackAccount(id: string, enabled: boolean): Promise<void> {
    await this.store.mutate({
      apply: (current) => {
        const fallbackAccountIds = current.fallbackAccountIds ?? []
        if (!enabled) {
          const remaining = fallbackAccountIds.filter((entry) => entry !== id)
          return {
            ...current,
            fallbackAccountIds: remaining,
            routingMode: remaining.length ? current.routingMode : undefined
          }
        }
        if (fallbackAccountIds.includes(id)) return current
        const primary = current.defaultModel
        const account = current.accounts[id]
        if (
          !primary ||
          id === primary.id ||
          !account ||
          !account.verified.includes(primary.modelId) ||
          !permitsModel(account, primary.modelId)
        )
          throw new ValidationError(
            'The fallback account must have the same verified and enabled model'
          )
        if (fallbackAccountIds.length >= 3)
          throw new ValidationError('Up to three fallback accounts are supported')
        return { ...current, fallbackAccountIds: [...fallbackAccountIds, id] }
      }
    })
  }

  async routeDefault(
    expected?: ChatGptModelSelection
  ): Promise<{ provider: string; modelId: string } | null> {
    const {
      defaultModel,
      fallbackAccountIds = [],
      routingMode = 'ordered'
    } = await this.store.read()
    if (expected && (defaultModel?.id !== expected.id || defaultModel.modelId !== expected.modelId))
      throw new ValidationError('The default ChatGPT model changed. Select a model again.')
    if (!defaultModel) return null
    const { id, modelId } = defaultModel
    if (!fallbackAccountIds.length) {
      if (await this.hasVerifiedModel(id, modelId)) return { provider: id, modelId }
      throw new ValidationError('No authorized account is available for the default ChatGPT model')
    }

    const candidates = [id, ...fallbackAccountIds]
    if (routingMode === 'roundRobin') {
      const pool = JSON.stringify([modelId, ...candidates])
      const index = this.rotation.pool === pool ? this.rotation.next : 0
      this.rotation = { pool, next: (index + 1) % candidates.length }
      candidates.push(...candidates.splice(0, index))
    }
    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(12_000)])
    for (const candidate of candidates) {
      if (signal.aborted) break
      const usable = await this.checkRoute(candidate, modelId, signal)
      if (usable && !signal.aborted) {
        const current = await this.store.read()
        if (
          current.defaultModel?.id !== id ||
          current.defaultModel.modelId !== modelId ||
          (current.routingMode ?? 'ordered') !== routingMode
        )
          throw new ValidationError('The default ChatGPT model changed. Select a model again.')
        const account = current.accounts[candidate]
        if (
          account?.verified.includes(modelId) &&
          permitsModel(account, modelId) &&
          (candidate === id || current.fallbackAccountIds?.includes(candidate))
        )
          return { provider: candidate, modelId }
      }
    }
    throw new ValidationError('No authorized account is available for the default ChatGPT model')
  }

  private async checkRoute(id: string, modelId: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false
    const candidateSignal = AbortSignal.any([signal, AbortSignal.timeout(3_000)])
    let abort: () => void = () => {}
    const deadline = new Promise<false>((resolve) => {
      abort = () => resolve(false)
      candidateSignal.addEventListener('abort', abort, { once: true })
    })
    try {
      const check = this.serial(id, async () => {
        candidateSignal.throwIfAborted()
        if (!(await this.hasVerifiedModel(id, modelId))) return false
        await this.accessToken(id, candidateSignal)
        return true
      }).catch(() => false)
      return await Promise.race([check, deadline])
    } finally {
      candidateSignal.removeEventListener('abort', abort)
    }
  }

  async verify(id: string, modelId: string): Promise<void> {
    const provider = await loadOpenAI()
    const model = provider.getModels().find((entry) => entry.id === modelId)
    if (!model) throw new ValidationError('Model not in the Pi catalog')
    await this.serial(id, async () => {
      const account = (await this.store.read()).accounts[id]
      if (!account || !permitsModel(account, modelId))
        throw new ValidationError('This model is unavailable for this ChatGPT account')
      const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(30_000)])
      const apiKey = await this.accessToken(id, signal)
      try {
        const { normalizeContext } = await import('@earendil-works/pi-ai')
        const result = await provider
          .streamSimple(
            model,
            normalizeContext({
              messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }]
            }),
            {
              apiKey,
              signal,
              fetch: (input, init) => systemFetch(input, { ...init, redirect: 'error' })
            }
          )
          .result()
        if (
          result.stopReason === 'error' ||
          result.stopReason === 'aborted' ||
          !result.content.some((part) => part.type === 'text' && part.text.trim())
        )
          throw new Error('Verification failed')
      } catch {
        throw new ValidationError('ChatGPT could not verify access to this model')
      }
      await this.store.mutate({
        apply: (current) => {
          const account = current.accounts[id]
          if (!account) throw credentialError()
          const verified = [...new Set([...account.verified, modelId])]
          return { ...current, accounts: { ...current.accounts, [id]: { ...account, verified } } }
        }
      })
    })
  }

  resolve(id: string, modelId: string): Promise<string> {
    return this.serial(id, async () => {
      if (!(await this.hasVerifiedModel(id, modelId))) throw credentialError()
      const token = await this.accessToken(
        id,
        AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(15_000)])
      )
      const now = Date.now()
      const account = (await this.store.read()).accounts[id]
      if (account && (account.lastUsedAt ?? 0) < now - 60_000) {
        await this.store
          .mutate({
            apply: (current) => {
              const entry = current.accounts[id]
              return entry
                ? {
                    ...current,
                    accounts: { ...current.accounts, [id]: { ...entry, lastUsedAt: now } }
                  }
                : current
            }
          })
          .catch(() => {})
      }
      return token
    })
  }

  async disconnect(id: string): Promise<{ revoked: boolean }> {
    return this.serial(id, async () => {
      const record = (await this.store.read()).accounts[id]
      if (!record) throw credentialError()
      let revoked = false
      try {
        const credential = this.decrypt(record)
        const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(10_000)])
        const discovery = await systemFetch(origin + '/.well-known/openid-configuration', {
          redirect: 'error',
          signal
        })
        if (discovery.ok) {
          const { revocation_endpoint: endpoint } = await discovery.json()
          if (typeof endpoint === 'string' && new URL(endpoint).origin === origin) {
            const response = await systemFetch(endpoint, {
              method: 'POST',
              redirect: 'error',
              signal,
              body: new URLSearchParams({
                token: credential.refresh,
                token_type_hint: 'refresh_token',
                client_id: String(credential.clientId)
              })
            })
            revoked = response.ok
            await response.body?.cancel()
          }
        }
      } catch {
        // Local removal must still work if the authorization was already revoked.
      }
      await this.store.mutate({
        apply: (current) => {
          const accounts = { ...current.accounts }
          delete accounts[id]
          return {
            ...current,
            accounts,
            defaultModel: current.defaultModel?.id === id ? undefined : current.defaultModel,
            routingMode: current.defaultModel?.id === id ? undefined : current.routingMode,
            fallbackAccountIds:
              current.defaultModel?.id === id
                ? []
                : current.fallbackAccountIds?.filter((entry) => entry !== id)
          }
        }
      })
      this.catalogFailures.delete(id)
      return { revoked }
    })
  }

  private async accessToken(id: string, signal: AbortSignal): Promise<string> {
    try {
      const record = (await this.store.read()).accounts[id]
      if (!record) throw credentialError()
      let credential = this.decrypt(record)
      if (credential.expires <= Date.now() + 60_000) {
        const refresh = (await loadOpenAI()).auth.oauth!.refresh
        credential = await withSystemProxyFetch(() => refresh(credential, signal))
        const ciphertext = this.encrypt(credential)
        await this.store.mutate({
          apply: (current) => ({
            ...current,
            accounts: {
              ...current.accounts,
              [id]: { ...current.accounts[id], ciphertext, expires: credential.expires }
            }
          })
        })
      }
      signal.throwIfAborted()
      return credential.access
    } catch {
      throw credentialError()
    }
  }

  private serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.operations.get(id) ?? Promise.resolve()).catch(() => {}).then(operation)
    this.operations.set(id, next)
    return next.finally(() => {
      if (this.operations.get(id) === next) this.operations.delete(id)
    })
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

  private decrypt(record: AccountRecord): OAuthCredential {
    this.assertStorage()
    return JSON.parse(safeStorage.decryptString(Buffer.from(record.ciphertext, 'base64')))
  }
}
