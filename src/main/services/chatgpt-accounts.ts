import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { safeStorage } from 'electron'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { z } from 'zod'
import {
  CHATGPT_MODEL_ID,
  CHATGPT_PROVIDER_PREFIX,
  isSelectableChatGptModel,
  latestChatGptModels,
  orderChatGptModels,
  type ChatGptAccount,
  type ChatGptAllowance,
  type ChatGptResetPolicy,
  type ChatGptCatalogIssue,
  type ChatGptModelSelection,
  type ChatGptModelMode,
  type ChatGptModelPreferences,
  type ChatGptRoutingMode
} from '@shared/providers/account-management'
import { readBoundedJson } from './bounded-json'
import { AppError, ValidationError } from './errors'
import { atomicWriteText, JsonStore } from './storage'
import {
  decryptAccountTransfer,
  encryptAccountTransfer,
  maxAccountTransferBytes
} from './chatgpt-account-transfer'
import {
  OAuthExchangeError,
  systemFetch,
  takeCapturedIdToken,
  withSystemProxyFetch
} from './system-fetch'
import {
  codexAccountFetch,
  codexUserAgent,
  consumeChatGptReset,
  quotaExhausted,
  readChatGptAllowance,
  tokenIdentity
} from './chatgpt-allowance'
import { readCodexSignIn } from './codex-sign-in'
import { log, redactSecretText } from './logger'
import {
  AccountRequestQueue,
  ProviderRequestQueue,
  releaseOnResponseClose
} from './provider-request-queue'
import type { ChatGptGatewaySettings } from '@shared/providers/advanced-settings'
import { fetchProvider } from './provider-network'
import {
  maskProviderPrompt,
  modelLimit
} from '../../../resources/desktop-extension/provider-settings.mjs'

type StoredCredential = OAuthCredential & { idToken?: string; identityChecked?: boolean }

type AccountRecord = {
  label: string
  ciphertext: string
  expires: number
  verified: string[]
  lastUsedAt?: number
  disabled?: string[]
  modelMode?: ChatGptModelMode
  selectedModels?: string[]
  addedModelIds?: string[]
  routingOnly?: boolean
  resetPolicy?: ChatGptResetPolicy
  resetSpentWeekUntil?: number
  catalog?: { models: { id: string; name: string }[]; updatedAt: number }
}

type AccountStore = {
  deviceId: string | null
  accounts: Record<string, AccountRecord>
  defaultModel?: ChatGptModelSelection
  fallbackAccountIds?: string[]
  routingMode?: ChatGptRoutingMode
  gateway?: ChatGptGatewaySettings
}

const origin = 'https://auth.openai.com'
const catalogEndpoint = 'https://api.openai.com/v1/models'
const responsesEndpoint = 'https://api.openai.com/v1/responses'
const accountCatalogSchema = z.object({ models: z.array(z.unknown()).max(1000) })
const accountModelSchema = z.object({
  slug: z.string().regex(CHATGPT_MODEL_ID),
  display_name: z.string().nullish().catch(undefined),
  visibility: z.string().nullish()
})
const apiCatalogSchema = z.object({
  object: z.literal('list'),
  data: z.array(z.unknown()).max(1000)
})
const apiModelSchema = z.object({ id: z.string().regex(CHATGPT_MODEL_ID) })

function parseCatalog(value: unknown, apiKey: string) {
  const account = accountCatalogSchema.safeParse(value)
  const unique = new Map<string, string>()
  if (account.success) {
    // Explicitly hidden entries stay hidden even if the response repeats the slug.
    const entries = account.data.models.flatMap((item) => {
      const result = accountModelSchema.safeParse(item)
      return result.success ? [result.data] : []
    })
    if (account.data.models.length && !entries.length) throw new Error('Invalid account models')
    const hidden = new Set(
      entries
        .filter((item) => item.visibility && item.visibility !== 'list')
        .map((item) => item.slug)
    )
    for (const item of entries) {
      if (hidden.has(item.slug) || item.slug.includes(apiKey) || unique.has(item.slug)) continue
      const label = item.display_name?.includes(apiKey) ? undefined : item.display_name
      unique.set(item.slug, label?.trim().slice(0, 160) || item.slug)
    }
  } else {
    const { data } = apiCatalogSchema.parse(value)
    const entries = data.flatMap((item) => {
      const result = apiModelSchema.safeParse(item)
      return result.success ? [result.data] : []
    })
    if (data.length && !entries.length) throw new Error('Invalid API models')
    for (const { id } of entries) {
      if (!id.includes(apiKey)) unique.set(id, id)
    }
  }
  return [...unique].map(([id, name]) => ({ id, name }))
}

function listsModel(account: AccountRecord, modelId: string): boolean {
  return (
    !account.catalog ||
    account.addedModelIds?.includes(modelId) === true ||
    account.catalog.models.some(({ id }) => id === modelId)
  )
}

function modelEnabled(
  account: AccountRecord,
  modelId: string,
  latest: ReadonlySet<string>
): boolean {
  if (account.modelMode === 'usage') return false
  if (account.modelMode === 'latest') return latest.has(modelId)
  if (account.modelMode === 'selected') return account.selectedModels?.includes(modelId) === true
  return !account.disabled?.includes(modelId)
}

function latestModels(account: AccountRecord, native: ReadonlySet<string>) {
  return new Set(
    latestChatGptModels(
      [...native].filter((id) => listsModel(account, id)).map((id) => ({ id }))
    ).map(({ id }) => id)
  )
}

function permitsModel(
  account: AccountRecord,
  modelId: string,
  native: ReadonlySet<string>
): boolean {
  return (
    native.has(modelId) &&
    listsModel(account, modelId) &&
    modelEnabled(
      account,
      modelId,
      account.modelMode === 'latest' ? latestModels(account, native) : new Set()
    )
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
  private readonly catalogFailures = new Map<string, ChatGptCatalogIssue>()
  private readonly gatewaySlots = new AccountRequestQueue()
  private readonly requestSlots = new ProviderRequestQueue()
  private rotation = { pool: '', next: 0 }

  constructor(file: string) {
    this.store = new JsonStore(file, defaults)
  }

  async list(): Promise<ChatGptAccount[]> {
    const { accounts, defaultModel, fallbackAccountIds, routingMode, gateway } =
      await this.store.read()
    if (!Object.keys(accounts).length) return []
    const [provider, { getSupportedThinkingLevels }] = await Promise.all([
      loadOpenAI(),
      import('@earendil-works/pi-ai')
    ])
    const native = new Map(provider.getModels().map((model) => [model.id, model]))
    const nativeIds = new Set(native.keys())
    return Object.entries(accounts).map(([id, record]) => {
      const entries = new Map(
        (record.catalog?.models ?? [...native.values()]).map((model) => [model.id, model])
      )
      for (const modelId of record.addedModelIds ?? []) {
        const entry = native.get(modelId)
        if (entry && !entries.has(modelId)) entries.set(modelId, entry)
      }
      const latest =
        record.modelMode === 'latest' ? latestModels(record, nativeIds) : new Set<string>()
      const models = orderChatGptModels([...entries.values()]).map(({ id: modelId, name }) => {
        const model = native.get(modelId)
        return {
          id: modelId,
          name: name === modelId ? (model?.name ?? name) : name,
          reasoning: model?.reasoning ?? false,
          vision: model?.input.includes('image') ?? false,
          contextWindow: model
            ? (modelLimit(gateway?.contextWindows, modelId) ?? model.contextWindow)
            : undefined,
          maxOutputTokens: model?.maxTokens,
          thinkingLevels: model?.reasoning ? getSupportedThinkingLevels(model) : undefined,
          verified: record.verified.includes(modelId),
          disabled: !modelEnabled(record, modelId, latest),
          unsupported: !model
        }
      })
      return {
        id,
        label: record.label,
        status: record.expires > Date.now() ? 'authorized' : 'expired',
        lastUsedAt: record.lastUsedAt,
        catalogUpdatedAt: record.catalog?.updatedAt,
        catalogFailed: this.catalogFailures.has(id),
        catalogIssue: this.catalogFailures.get(id),
        defaultModelId: defaultModel?.id === id ? defaultModel.modelId : undefined,
        recommendedModelId: models.find(isSelectableChatGptModel)?.id,
        routingMode: defaultModel?.id === id ? (routingMode ?? 'ordered') : undefined,
        fallbackRank: (fallbackAccountIds?.indexOf(id) ?? -1) + 1 || undefined,
        modelMode: record.modelMode,
        addedModelIds: record.addedModelIds,
        routingOnly: record.routingOnly,
        resetPolicy: record.resetPolicy,
        models
      }
    })
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
      const idToken = takeCapturedIdToken()
      const stored: StoredCredential = idToken ? { ...credential, idToken } : credential
      const record: AccountRecord = {
        label: id.slice(-8),
        expires: stored.expires,
        ciphertext: this.encrypt(stored),
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

  async hasSelectableModel(id: string, modelId: string): Promise<boolean> {
    const account = (await this.store.read()).accounts[id]
    return !!account && permitsModel(account, modelId, await this.nativeIds())
  }

  async isRoutingOnly(id: string): Promise<boolean> {
    return (await this.store.read()).accounts[id]?.routingOnly === true
  }

  private async nativeIds() {
    return new Set((await loadOpenAI()).getModels().map(({ id }) => id))
  }

  private async isNativeModel(modelId: string): Promise<boolean> {
    return (await loadOpenAI()).getModels().some((model) => model.id === modelId)
  }

  refreshCatalog(id: string): Promise<void> {
    const existing = this.catalogRefreshes.get(id)
    if (existing) return existing
    const request = this.serial(id, async () => {
      const account = (await this.store.read()).accounts[id]
      if (!account) throw credentialError()
      const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(15_000)])
      let reason: ChatGptCatalogIssue['reason'] = 'authorization'
      let status: number | undefined
      try {
        const apiKey = await this.accessToken(id, signal)
        reason = 'network'
        const response = await this.fetchWithProxy(catalogEndpoint, {
          headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
          redirect: 'error',
          signal
        })
        status = response.status
        if (!response.ok) {
          reason = 'http'
          await response.body?.cancel()
          throw new Error('Model catalog request failed')
        }
        reason = 'format'
        const models = parseCatalog(await readBoundedJson(response, 4 * 1024 * 1024), apiKey)
        reason = 'save'
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
        const issue: ChatGptCatalogIssue = {
          reason: signal.reason?.name === 'TimeoutError' ? 'timeout' : reason,
          status
        }
        this.catalogFailures.set(id, issue)
        log.provider.warn('ChatGPT model catalog refresh failed', issue)
        throw new ValidationError('ChatGPT could not refresh the account model catalog', issue)
      }
    }).finally(() => this.catalogRefreshes.delete(id))
    this.catalogRefreshes.set(id, request)
    return request
  }

  async setModelEnabled(id: string, modelId: string, enabled: boolean): Promise<void> {
    if (!(await this.isNativeModel(modelId))) throw credentialError()
    await this.serial(id, () =>
      this.store.mutate({
        apply: (current) => {
          const account = current.accounts[id]
          if (!account || !listsModel(account, modelId)) throw credentialError()
          const picked = account.modelMode === 'selected'
          const field = picked ? 'selectedModels' : 'disabled'
          if (account.modelMode === 'latest' || account.modelMode === 'usage')
            throw new ValidationError('Change this account’s model selection first')
          const models = new Set(account[field])
          if (enabled === picked) models.add(modelId)
          else models.delete(modelId)
          return {
            ...current,
            accounts: {
              ...current.accounts,
              [id]: { ...account, [field]: [...models] }
            }
          }
        }
      })
    )
  }

  async setModelSelection({
    id,
    mode,
    modelIds,
    addedModelIds,
    routingOnly
  }: ChatGptModelPreferences): Promise<void> {
    const native = await this.nativeIds()
    const selectedModels = mode === 'selected' ? [...new Set(modelIds)] : undefined
    const added = [...new Set(addedModelIds)]
    await this.serial(id, () =>
      this.store.mutate({
        apply: (current) => {
          const account = current.accounts[id]
          if (!account || added.some((modelId) => !native.has(modelId)))
            throw new ValidationError('Select models from this account catalog')
          const disabled =
            mode === 'catalog' && (account.modelMode ?? 'catalog') === 'catalog'
              ? account.disabled
              : undefined
          const updated = {
            ...account,
            modelMode: mode,
            selectedModels,
            addedModelIds: added,
            routingOnly,
            disabled
          }
          if (
            selectedModels?.some((modelId) => !native.has(modelId) || !listsModel(updated, modelId))
          )
            throw new ValidationError('Select models from this account catalog')
          const accounts = { ...current.accounts, [id]: updated }
          const next = { ...current, accounts }
          const primary = current.defaultModel
          if (!primary || (id !== primary.id && !current.fallbackAccountIds?.includes(id)))
            return next
          const candidates = [primary.id, ...(current.fallbackAccountIds ?? [])]
          if (
            !accounts[primary.id]?.routingOnly &&
            candidates.some(
              (candidate) =>
                accounts[candidate] && permitsModel(accounts[candidate], primary.modelId, native)
            )
          )
            return next
          return {
            ...next,
            defaultModel: undefined,
            fallbackAccountIds: [],
            routingMode: undefined
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

  async allowance(id: string): Promise<ChatGptAllowance | null> {
    const signal = AbortSignal.timeout(20_000)
    return this.readAllowance(id, signal)
  }

  async setResetPolicy(id: string, policy: ChatGptResetPolicy): Promise<void> {
    await this.store.mutate({
      apply: (current) => {
        const account = current.accounts[id]
        if (!account) throw credentialError()
        return {
          ...current,
          accounts: { ...current.accounts, [id]: { ...account, resetPolicy: policy } }
        }
      }
    })
  }

  async useReset(id: string): Promise<boolean> {
    const signal = AbortSignal.timeout(20_000)
    const credential = await this.credentialFor(id, signal, true)
    return consumeChatGptReset(credential.access, codexAccountFetch, signal, credential.idToken)
  }

  async setDefaultModel(defaultModel: ChatGptModelSelection | null): Promise<void> {
    const native = defaultModel ? await this.nativeIds() : new Set<string>()
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
        if (!account || account.routingOnly || !permitsModel(account, modelId, native))
          throw new ValidationError('Select an available ChatGPT model')
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
    const native = enabled ? await this.nativeIds() : new Set<string>()
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
          !permitsModel(account, primary.modelId, native)
        )
          throw new ValidationError('The fallback account must have the same enabled model')
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
    const native = await this.nativeIds()
    if (!fallbackAccountIds.length) {
      if (await this.hasSelectableModel(id, modelId)) return { provider: id, modelId }
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
          account &&
          permitsModel(account, modelId, native) &&
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
        if (!(await this.hasSelectableModel(id, modelId))) return false
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
    const native = await this.nativeIds()
    const model = provider.getModels().find((entry) => entry.id === modelId)
    if (!model) throw new ValidationError('Model not in the Pi catalog')
    await this.serial(id, async () => {
      const account = (await this.store.read()).accounts[id]
      if (!account || !permitsModel(account, modelId, native))
        throw new ValidationError('This model is unavailable for this ChatGPT account')
      const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(30_000)])
      const apiKey = await this.accessToken(id, signal)
      let status: number | undefined
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
              maxRetries: 0,
              fetch: async (input, init) => {
                if (String(input) !== responsesEndpoint)
                  throw new Error('Unexpected ChatGPT request endpoint')
                const response = await this.requestResponses(apiKey, signal, init?.body)
                if (!response.ok) status = response.status
                return response
              }
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
        throw new ValidationError('ChatGPT could not verify access to this model', {
          reason:
            signal.reason?.name === 'TimeoutError'
              ? 'timeout'
              : status === 502
                ? 'network'
                : status
                  ? 'http'
                  : 'response',
          status
        })
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
      if (!(await this.hasSelectableModel(id, modelId))) throw credentialError()
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

  async fetchResponses(id: string, modelId: string, init?: RequestInit): Promise<Response> {
    const signal = AbortSignal.any([this.shutdown.signal, ...(init?.signal ? [init.signal] : [])])
    signal.throwIfAborted()
    const settings = await this.gatewaySettings()
    const releaseAccount = settings.maxAccounts
      ? await this.gatewaySlots.acquire(
          id,
          { ...settings, maxAccounts: settings.maxAccounts },
          signal
        )
      : undefined
    let releaseRequest: (() => void) | undefined
    const release = () => {
      releaseRequest?.()
      releaseAccount?.()
    }
    try {
      if (settings.concurrency || settings.requestsPerMinute)
        releaseRequest = await this.requestSlots.acquire(settings, signal)
      const apiKey = await this.resolve(id, modelId).catch(() => null)
      signal.throwIfAborted()
      if (!apiKey) {
        release()
        return Response.json({ error: { message: credentialError().message } }, { status: 401 })
      }
      const record = (await this.store.read()).accounts[id]
      const spentExpiring = record?.resetPolicy?.expiring
        ? await this.spendExpiringReset(id, record.resetPolicy.leadMinutes, signal).catch(
            () => false
          )
        : false
      const response = await this.requestResponses(apiKey, signal, init?.body, settings)
      const reusable = typeof init?.body !== 'object'
      const retry =
        !spentExpiring &&
        reusable &&
        record?.resetPolicy?.week &&
        response.status === 429 &&
        (await this.spendWeekReset(id, signal).catch(() => false))
          ? await this.requestResponses(apiKey, signal, init?.body, settings)
          : response
      return releaseAccount || releaseRequest
        ? releaseOnResponseClose(retry, release, signal)
        : retry
    } catch (error) {
      release()
      throw error
    }
  }

  async gatewayRequest(
    id: string,
    modelId: string,
    payload: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Response> {
    if (await this.isRoutingOnly(id))
      return Response.json(
        { error: { message: 'This account is only available as a fallback.' } },
        { status: 404 }
      )
    const {
      background: _background,
      max_output_tokens: _maxOutput,
      prompt_cache_retention: _retention,
      temperature: _temperature,
      top_p: _topP,
      truncation: _truncation,
      previous_response_id: _previous,
      conversation: _conversation,
      ...request
    } = payload
    const body = JSON.stringify({ ...request, model: modelId, stream: true, store: false })
    return this.fetchResponses(id, modelId, { body, signal })
  }

  async gatewaySettings() {
    return (await this.store.read()).gateway ?? {}
  }

  async setGatewaySettings(settings: ChatGptGatewaySettings) {
    await this.store.mutate({ apply: (current) => ({ ...current, gateway: settings }) })
  }

  async runtimeSettings(id: string, baseUrl: string) {
    if (
      !id.startsWith(CHATGPT_PROVIDER_PREFIX) ||
      baseUrl.replace(/\/$/, '') !== 'https://api.openai.com/v1'
    )
      return
    const state = await this.store.read()
    return state.accounts[id] ? state.gateway : undefined
  }

  async usageSettings() {
    const { accounts, gateway } = await this.store.read()
    return Object.fromEntries(
      Object.keys(accounts).map((id) => [id, { billing: 'subscription' as const, ...gateway }])
    )
  }

  private async fetchWithProxy(url: string, init: RequestInit, settings?: ChatGptGatewaySettings) {
    const { proxy } = settings ?? (await this.gatewaySettings())
    return proxy && proxy.mode !== 'system'
      ? fetchProvider(url, init, proxy)
      : systemFetch(url, init)
  }

  private async requestResponses(
    apiKey: string,
    signal: AbortSignal,
    body: RequestInit['body'],
    settings?: ChatGptGatewaySettings
  ): Promise<Response> {
    const preference = settings ?? (await this.gatewaySettings())
    const json = preference.redactSecrets && body ? await new Response(body).json() : undefined
    let response: Response
    try {
      response = await this.fetchWithProxy(
        responsesEndpoint,
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            accept: 'text/event-stream'
          },
          body: json === undefined ? body : JSON.stringify(maskProviderPrompt(json)),
          signal
        },
        preference
      )
    } catch {
      signal.throwIfAborted()
      log.provider.warn('ChatGPT Responses connection failed')
      return Response.json(
        {
          error: {
            message: 'Pi-Harness could not connect to OpenAI. Check your network and system proxy.'
          }
        },
        { status: 502 }
      )
    }
    if (response.ok) return response
    const payload = await readBoundedJson(response, 32_768).catch(() => null)
    const error = (payload as { error?: { code?: unknown; message?: unknown } } | null)?.error
    const code =
      typeof error?.code === 'string' && /^[a-z_]{1,64}$/.test(error.code)
        ? error.code.replaceAll(apiKey, '[redacted]')
        : undefined
    const message =
      typeof error?.message === 'string'
        ? redactSecretText(error.message.replaceAll(apiKey, '[redacted]')).slice(0, 400)
        : `OpenAI returned HTTP ${response.status}`
    log.provider.warn('ChatGPT Responses request rejected', { status: response.status })
    return Response.json({ error: { code, message } }, { status: response.status })
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

  async exportAccount(id: string, file: string, password: string) {
    await this.serial(id, async () => {
      const record = (await this.store.read()).accounts[id]
      if (!record) throw credentialError()
      const credential = this.decrypt(record)
      if (typeof credential.clientId !== 'string') throw credentialError()
      const text = await encryptAccountTransfer(
        { label: record.label, credential: { ...credential, clientId: credential.clientId } },
        password
      )
      await atomicWriteText(file, text)
    })
  }

  async importAccount(file: string, password: string) {
    this.assertStorage()
    const handle = await open(file, 'r')
    let text: string
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > maxAccountTransferBytes)
        throw new ValidationError('Invalid ChatGPT account backup')
      const buffer = Buffer.alloc(maxAccountTransferBytes + 1)
      let size = 0
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size)
        if (!bytesRead) break
        size += bytesRead
      }
      if (size > maxAccountTransferBytes)
        throw new ValidationError('Invalid ChatGPT account backup')
      text = buffer.toString('utf8', 0, size)
    } finally {
      await handle.close()
    }
    const { credential, label } = await decryptAccountTransfer(text, password)
    const id = CHATGPT_PROVIDER_PREFIX + randomUUID()
    await this.store.mutate({
      apply: (current) => {
        const records = Object.values(current.accounts)
        if (records.length >= 20) throw new ValidationError('ChatGPT account limit reached')
        if (records.some((record) => this.decrypt(record).clientId === credential.clientId))
          throw new ValidationError('This ChatGPT account is already connected')
        const record = {
          label,
          expires: credential.expires,
          ciphertext: this.encrypt(credential),
          verified: []
        }
        return {
          ...current,
          deviceId: current.deviceId ?? randomUUID(),
          accounts: { ...current.accounts, [id]: record }
        }
      }
    })
  }

  private async spendWeekReset(id: string, signal: AbortSignal): Promise<boolean> {
    const record = (await this.store.read()).accounts[id]
    if (!record?.resetPolicy?.week || (record.resetSpentWeekUntil ?? 0) > Date.now()) return false
    const { access, allowance } = await this.readAllowanceParts(id, signal)
    if (!allowance || !quotaExhausted('week', allowance.windows) || allowance.resets.count < 1)
      return false
    if (!(await consumeChatGptReset(access, systemFetch, signal))) return false
    const week = [...allowance.windows].sort((left, right) => right.seconds - left.seconds)[0]
    const until =
      week?.resetAt && week.resetAt > Date.now()
        ? week.resetAt
        : Date.now() + 7 * 24 * 60 * 60 * 1000
    await this.store.mutate({
      apply: (current) => {
        const entry = current.accounts[id]
        return entry
          ? {
              ...current,
              accounts: {
                ...current.accounts,
                [id]: { ...entry, resetSpentWeekUntil: until }
              }
            }
          : current
      }
    })
    return true
  }

  private async spendExpiringReset(
    id: string,
    leadMinutes: number,
    signal: AbortSignal
  ): Promise<boolean> {
    const { access, allowance } = await this.readAllowanceParts(id, signal)
    const expires = allowance?.resets.expiresAt
    const lead = Math.min(1440, Math.max(5, leadMinutes)) * 60_000
    if (!allowance || allowance.resets.count < 1 || !expires || expires <= Date.now()) return false
    if (expires - Date.now() > lead) return false
    return consumeChatGptReset(access, systemFetch, signal)
  }

  private async readAllowance(id: string, signal: AbortSignal): Promise<ChatGptAllowance | null> {
    return (await this.readAllowanceParts(id, signal)).allowance
  }

  private async readAllowanceParts(
    id: string,
    signal: AbortSignal
  ): Promise<{ access: string; allowance: ChatGptAllowance | null }> {
    const credential = await this.credentialFor(id, signal, true)
    const own = await readChatGptAllowance(
      credential.access,
      codexAccountFetch,
      signal,
      credential.idToken
    )
    return { access: credential.access, allowance: await this.codexAllowance(own, signal) }
  }

  /** The same ChatGPT account signed in to Codex, when this grant cannot read its allowance. */
  private async codexAllowance(
    own: ChatGptAllowance | null,
    signal: AbortSignal
  ): Promise<ChatGptAllowance | null> {
    if (own?.windows.length) return own
    const codex = await readCodexSignIn().catch(() => null)
    if (!codex) return own
    const read = await readChatGptAllowance(
      codex.access,
      codexAccountFetch,
      signal,
      codex.idToken,
      codex.accountId
    ).catch(() => null)
    if (!read?.windows.length && !read?.resets.expiresAt && !read?.plan) return own
    const same =
      !!own?.email &&
      !!read?.email &&
      own.email.localeCompare(read.email, undefined, { sensitivity: 'accent' }) === 0
    if (own?.email && !same) return own
    return read ? { ...read, email: own?.email || read.email } : own
  }

  private async accessToken(id: string, signal: AbortSignal): Promise<string> {
    return (await this.credentialFor(id, signal, false)).access
  }

  private async credentialFor(
    id: string,
    signal: AbortSignal,
    withIdentity: boolean
  ): Promise<StoredCredential> {
    try {
      const record = (await this.store.read()).accounts[id]
      if (!record) throw credentialError()
      let credential = this.decrypt(record)
      const named = tokenIdentity(credential.access)
      if (credential.expires <= Date.now() + 60_000) {
        const kept = credential.idToken
        const refresh = (await loadOpenAI()).auth.oauth!.refresh
        credential = await withSystemProxyFetch(() => refresh(credential, signal))
        credential = {
          ...credential,
          idToken: takeCapturedIdToken() ?? kept
        }
        await this.saveCredential(id, credential)
      } else if (withIdentity && !credential.idToken && (!named.accountId || !named.plan)) {
        credential = await this.refreshIdentity(id, credential, signal).catch(() => credential)
      }
      signal.throwIfAborted()
      return credential
    } catch {
      throw credentialError()
    }
  }

  private async refreshIdentity(
    id: string,
    credential: StoredCredential,
    signal: AbortSignal
  ): Promise<StoredCredential> {
    try {
      return await this.exchangeIdentity(id, credential, signal)
    } catch {
      return credential
    } finally {
      takeCapturedIdToken()
    }
  }

  private async exchangeIdentity(
    id: string,
    credential: StoredCredential,
    signal: AbortSignal
  ): Promise<StoredCredential> {
    const clientId = credential.clientId
    if (typeof clientId !== 'string' || !credential.refresh) return credential
    const response = await codexAccountFetch('https://auth.openai.com/api/accounts/oauth/token', {
      method: 'POST',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        originator: 'codex_cli_rs',
        'user-agent': codexUserAgent()
      },
      body: JSON.stringify({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: credential.refresh,
        refresh_reason: 'forced'
      }),
      signal
    })
    const captured = takeCapturedIdToken()
    if (!response.ok) {
      log.provider.warn('ChatGPT identity refresh failed', { status: response.status })
      return credential
    }
    const body = (await response.json().catch(() => null)) as {
      access_token?: unknown
      refresh_token?: unknown
      expires_in?: unknown
      id_token?: unknown
    } | null
    const access = typeof body?.access_token === 'string' ? body.access_token : ''
    if (!access) return credential
    const idToken =
      (typeof body?.id_token === 'string' ? body.id_token : undefined) ??
      captured ??
      credential.idToken
    const next: StoredCredential = {
      ...credential,
      access,
      refresh: typeof body?.refresh_token === 'string' ? body.refresh_token : credential.refresh,
      expires:
        typeof body?.expires_in === 'number' && body.expires_in > 0
          ? Date.now() + body.expires_in * 1000 - 180_000
          : credential.expires,
      idToken,
      identityChecked: !idToken
    }
    await this.saveCredential(id, next)
    return next
  }

  private async saveCredential(id: string, credential: StoredCredential): Promise<void> {
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

  private decrypt(record: AccountRecord): StoredCredential {
    this.assertStorage()
    return JSON.parse(safeStorage.decryptString(Buffer.from(record.ciphertext, 'base64')))
  }
}
