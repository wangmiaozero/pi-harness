/**
 * ProviderService — CRUD over Pi models.json providers + Pi-Harness metadata.
 */

import type { DiscoveredProviderModel, ProviderProfile } from '@shared/types/domain'
import type { ProviderForm, ProviderModelDiscoveryInput } from '@shared/schemas/domain'
import { providerFormSchema, providerModelDiscoverySchema } from '@shared/schemas/domain'
import type { JsonStore } from '../services/storage'
import type { AppMetadata } from '../services/metadata-store'
import { NotFoundError, ValidationError } from '../services/errors'
import { secretStore } from '../security/secret-store'
import type { PiConfigService, WriteOptions } from '../pi/config-service'
import {
  domainProviderToPi,
  domainModelToPi,
  providerToDomain,
  resolveApiKeyForPi
} from '../pi/adapter'
import { randomBytes } from 'node:crypto'
import type { ConnectionTestResult } from '@shared/ipc/api-types'
import { getProtocol } from '@shared/constants/protocols'
import { log, redactSecretText } from '../services/logger'
import { normalizeProviderBaseUrl, volcenginePlanKind } from '@shared/utils/base-url'
import type { PiProviderConfig } from '@shared/types/pi'

export class ProviderService {
  constructor(
    private readonly config: PiConfigService,
    private readonly metadata: JsonStore<AppMetadata>
  ) {}

  async list(): Promise<ProviderProfile[]> {
    const snap = await this.config.read()
    const meta = await this.metadata.read()
    const providerKeys = Object.keys(snap.models.providers)
    const enabledKey = resolveEnabledProviderKey(
      providerKeys,
      meta.providers,
      snap.settings.defaultProvider ?? null
    )
    return Object.entries(snap.models.providers).map(([key, pi]) =>
      providerToDomain(key, pi, {
        ...meta.providers[key],
        enabled: key === enabledKey
      })
    )
  }

  async get(key: string): Promise<ProviderProfile | null> {
    const all = await this.list()
    return all.find((p) => p.key === key) ?? null
  }

  async create(raw: unknown, options?: WriteOptions): Promise<ProviderProfile> {
    const form = this.parseForm(raw)
    const existing = await this.get(form.key)
    if (existing) throw new ValidationError(`Provider key already exists: ${form.key}`)

    const secretId = await this.persistSecret(form.key, form.apiKey)
    const apiKeySpec = secretId ? ({ kind: 'stored' } as const) : form.apiKey
    const apiKeyValue = await resolveApiKeyForPi(apiKeySpec, secretId)

    await this.config.patchProvider(
      form.key,
      (cur) => {
        const next = domainProviderToPi(cur, {
          protocol: form.protocol,
          baseUrl: form.baseUrl,
          headers: form.headers,
          authHeader: form.authHeader,
          apiKeyValue
        })
        return ensureDefaultModel(
          mergeDiscoveredModels(next, form.discoveredModels ?? [], form.protocol),
          form.defaultModelId ?? null,
          form.protocol,
          form.defaultModel ?? null
        )
      },
      { overwrite: options?.overwrite, reason: `create provider ${form.key}` }
    )

    const now = Date.now()
    const meta = await this.metadata.read()
    const providersMeta = { ...meta.providers }
    if (form.enabled) {
      for (const k of Object.keys((await this.config.read()).models.providers)) {
        const prev = providersMeta[k] ?? {}
        providersMeta[k] = {
          ...prev,
          enabled: k === form.key,
          updatedAt: now,
          createdAt: prev.createdAt ?? now
        }
      }
    }
    providersMeta[form.key] = {
      ...providersMeta[form.key],
      name: form.name,
      displayName: form.displayName,
      enabled: form.enabled,
      timeout: form.timeout,
      apiKeyRef: secretId,
      defaultModelId: form.defaultModelId ?? null,
      createdAt: providersMeta[form.key]?.createdAt ?? now,
      updatedAt: now
    }
    await this.metadata.update({ providers: providersMeta })

    // Bootstrap active model when none is set
    if (form.defaultModelId) {
      const active = await this.config.getActiveModel()
      if (!active.providerKey || !active.modelId) {
        try {
          await this.config.setActiveModel(form.key, form.defaultModelId, {
            overwrite: true,
            reason: `bootstrap active ${form.key}/${form.defaultModelId}`
          })
        } catch (err) {
          log.provider.warn('bootstrap active model failed', err)
        }
      }
    }

    const created = await this.get(form.key)
    if (!created) throw new ValidationError('Provider create failed')
    return created
  }

  async update(key: string, raw: unknown, options?: WriteOptions): Promise<ProviderProfile> {
    const form = this.parseForm(raw)
    const current = await this.get(key)
    if (!current) throw new NotFoundError(`Provider not found: ${key}`)

    const newKey = form.key
    if (newKey !== key) {
      const clash = await this.get(newKey)
      if (clash) throw new ValidationError(`Provider key already exists: ${newKey}`)
    }

    let secretId = current.apiKeyRef
    if (form.apiKey?.kind === 'literal' && form.apiKey.literal) {
      secretId = secretId ?? `prov-${key}-${randomBytes(4).toString('hex')}`
      await secretStore.setSecret(secretId, form.apiKey.literal)
      form.apiKey = { kind: 'stored' }
    } else if (form.apiKey === null && secretId) {
      await secretStore.removeSecret(secretId)
      secretId = null
    }

    const apiKeyValue =
      form.apiKey === null
        ? ''
        : form.apiKey?.kind === 'literal' && !form.apiKey.literal
          ? undefined // keep existing
          : await resolveApiKeyForPi(form.apiKey, secretId)

    const applyPi = (cur: PiProviderConfig | undefined) => {
      if (!cur) throw new NotFoundError(`Provider not found: ${key}`)
      const next = domainProviderToPi(cur, {
        protocol: form.protocol,
        baseUrl: form.baseUrl,
        headers: form.headers,
        authHeader: form.authHeader,
        apiKeyValue
      })
      return ensureDefaultModel(
        mergeDiscoveredModels(next, form.discoveredModels ?? [], form.protocol),
        form.defaultModelId ?? null,
        form.protocol,
        form.defaultModel ?? null
      )
    }

    if (newKey === key) {
      await this.config.patchProvider(key, applyPi, {
        overwrite: options?.overwrite,
        reason: `update provider ${key}`
      })
    } else {
      await this.config.patchModels(
        (models) => {
          const providers = { ...models.providers }
          const cur = providers[key]
          if (!cur) throw new NotFoundError(`Provider not found: ${key}`)
          delete providers[key]
          providers[newKey] = applyPi(cur)
          return { ...models, providers }
        },
        { overwrite: options?.overwrite, reason: `rename provider ${key} → ${newKey}` }
      )
      const active = await this.config.getActiveModel()
      if (active.providerKey === key && active.modelId) {
        await this.config.setActiveModel(newKey, active.modelId, {
          overwrite: options?.overwrite ?? true,
          reason: `retarget active after rename ${key} → ${newKey}`,
          skipBackup: true
        })
      }
    }

    const meta = await this.metadata.read()
    const now = Date.now()
    const providersMeta = { ...meta.providers }
    let modelsMeta = { ...meta.models }

    if (newKey !== key) {
      const oldProv = providersMeta[key]
      delete providersMeta[key]
      providersMeta[newKey] = { ...oldProv }
      const prefix = `${key}::`
      const moved: typeof modelsMeta = {}
      for (const [mk, mv] of Object.entries(modelsMeta)) {
        if (mk.startsWith(prefix)) {
          moved[`${newKey}::${mk.slice(prefix.length)}`] = mv
        } else {
          moved[mk] = mv
        }
      }
      modelsMeta = moved
    }

    if (form.enabled) {
      for (const k of Object.keys((await this.config.read()).models.providers)) {
        const prev = providersMeta[k] ?? {}
        providersMeta[k] = {
          ...prev,
          enabled: k === newKey,
          updatedAt: now,
          createdAt: prev.createdAt ?? now
        }
      }
    }
    providersMeta[newKey] = {
      ...providersMeta[newKey],
      name: form.name,
      displayName: form.displayName,
      enabled: form.enabled,
      timeout: form.timeout,
      apiKeyRef: secretId,
      defaultModelId:
        form.defaultModelId !== undefined
          ? form.defaultModelId
          : (providersMeta[newKey]?.defaultModelId ?? null),
      updatedAt: now,
      createdAt: providersMeta[newKey]?.createdAt ?? now
    }
    await this.metadata.write({ ...meta, providers: providersMeta, models: modelsMeta })

    const updated = await this.get(newKey)
    if (!updated) throw new ValidationError('Provider update failed')
    return updated
  }

  async delete(key: string, options?: WriteOptions): Promise<void> {
    const current = await this.get(key)
    if (!current) throw new NotFoundError(`Provider not found: ${key}`)
    if (current.apiKeyRef) await secretStore.removeSecret(current.apiKeyRef)

    // Cascade: deleting the provider entry also removes every nested model in models.json.
    await this.config.patchProvider(key, () => undefined, {
      overwrite: options?.overwrite,
      reason: `delete provider ${key} (cascade models)`
    })

    const active = await this.config.getActiveModel()
    if (active.providerKey === key) {
      await this.retargetActiveAfterProviderRemoved(key, options)
    }

    const meta = await this.metadata.read()
    const providers = { ...meta.providers }
    delete providers[key]
    const models = { ...meta.models }
    for (const k of Object.keys(models)) {
      if (k === key || k.startsWith(`${key}::`)) delete models[k]
    }
    await this.metadata.write({ ...meta, providers, models })
  }

  /** Pick another provider/model for settings.json, or clear active if none left. */
  private async retargetActiveAfterProviderRemoved(
    removedKey: string,
    options?: WriteOptions
  ): Promise<void> {
    const snap = await this.config.read()
    const meta = await this.metadata.read()
    let fallback: { providerKey: string; modelId: string } | null = null
    let enabledFallback: { providerKey: string; modelId: string } | null = null

    for (const [pkey, pi] of Object.entries(snap.models.providers)) {
      if (pkey === removedKey) continue
      const modelId =
        meta.providers[pkey]?.defaultModelId?.trim() || pi.models?.[0]?.id?.trim() || ''
      if (!modelId) continue
      const candidate = { providerKey: pkey, modelId }
      fallback ??= candidate
      if (meta.providers[pkey]?.enabled !== false) {
        enabledFallback = candidate
        break
      }
    }

    const next = enabledFallback ?? fallback
    if (next) {
      await this.config.setActiveModel(next.providerKey, next.modelId, {
        overwrite: options?.overwrite ?? true,
        reason: `retarget active after delete provider ${removedKey}`,
        skipBackup: true
      })
      return
    }

    await this.config.patchSettings(
      (s) => ({ ...s, defaultProvider: undefined, defaultModel: undefined }),
      {
        overwrite: options?.overwrite ?? true,
        reason: `clear active after delete provider ${removedKey}`,
        skipBackup: true
      }
    )
  }

  async duplicate(key: string, options?: WriteOptions): Promise<ProviderProfile> {
    const src = await this.get(key)
    if (!src) throw new NotFoundError(`Provider not found: ${key}`)
    const snap = await this.config.read()
    const pi = snap.models.providers[key]
    if (!pi) throw new NotFoundError(`Provider not found: ${key}`)

    let n = 2
    let newKey = `${key}-copy`
    while (snap.models.providers[newKey]) {
      newKey = `${key}-copy-${n++}`
    }

    await this.config.patchProvider(newKey, () => ({ ...structuredClone(pi) }), {
      overwrite: options?.overwrite,
      reason: `duplicate provider ${key} → ${newKey}`
    })

    const meta = await this.metadata.read()
    const now = Date.now()
    await this.metadata.update({
      providers: {
        ...meta.providers,
        [newKey]: {
          ...meta.providers[key],
          displayName: `${src.displayName} Copy`,
          enabled: false,
          createdAt: now,
          updatedAt: now
        }
      }
    })

    const dup = await this.get(newKey)
    if (!dup) throw new ValidationError('Duplicate failed')
    return dup
  }

  /** Quick enable toggle — at most one provider may be enabled.
   * Enabling also switches Pi's active model to this provider's default / first model.
   */
  async setEnabled(key: string, enabled: boolean): Promise<ProviderProfile> {
    const current = await this.get(key)
    if (!current) throw new NotFoundError(`Provider not found: ${key}`)

    const snap = await this.config.read()
    const meta = await this.metadata.read()
    const now = Date.now()
    const providersMeta = { ...meta.providers }

    if (enabled) {
      for (const k of Object.keys(snap.models.providers)) {
        const prev = providersMeta[k] ?? {}
        providersMeta[k] = {
          ...prev,
          enabled: k === key,
          updatedAt: now,
          createdAt: prev.createdAt ?? now
        }
      }
    } else {
      const prev = providersMeta[key] ?? {}
      providersMeta[key] = {
        ...prev,
        enabled: false,
        updatedAt: now,
        createdAt: prev.createdAt ?? now
      }
    }

    await this.metadata.update({ providers: providersMeta })

    if (enabled) {
      const modelId = current.defaultModelId?.trim() || (await this.firstModelId(key)) || null
      if (modelId) {
        try {
          await this.config.setActiveModel(key, modelId, {
            overwrite: true,
            reason: `enable provider ${key} → active ${key}/${modelId}`
          })
        } catch (err) {
          log.provider.warn('set active model after enable failed:', err)
        }
      }
    }

    const updated = await this.get(key)
    if (!updated) throw new ValidationError('setEnabled failed')
    return updated
  }

  /** Read a provider's model-list endpoint without mutating models.json. */
  async discoverModels(raw: ProviderModelDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    const parsed = providerModelDiscoverySchema.safeParse(raw)
    if (!parsed.success) {
      throw new ValidationError('Invalid model discovery input', { issues: parsed.error.issues })
    }
    const input = parsed.data
    const normalized = normalizeProviderBaseUrl(input.baseUrl)
    let root: URL
    try {
      root = new URL(normalized.url)
    } catch {
      throw new ValidationError('Base URL must be a valid HTTP(S) URL')
    }
    if (!['http:', 'https:'].includes(root.protocol)) {
      throw new ValidationError('Base URL must use HTTP or HTTPS')
    }

    const existing = input.existingProviderKey ? await this.get(input.existingProviderKey) : null
    const apiKey = await resolveDiscoveryCredential(input.apiKey, existing)
    const candidates = buildModelListCandidates(input.protocol, root, apiKey, input.authHeader)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(input.timeout ?? 30_000, 120_000))
    const models = new Map<string, DiscoveredProviderModel>()
    let catalogMissing = false

    try {
      for (const candidate of candidates) {
        const headers: Record<string, string> = { ...input.headers, ...candidate.headers }
        setHeaderIfMissing(headers, 'Accept', 'application/json')
        let url = candidate.url
        let reachedCatalog = false

        for (let page = 0; page < 20 && models.size < 2_000; page++) {
          const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })
          const text = await response.text()
          if (!response.ok) {
            const planRoot = volcenginePlanKind(normalized.url)
            if (
              input.protocol === 'anthropic-messages' &&
              (isMissingModelCatalogStatus(response.status) ||
                catalogMissing ||
                planRoot !== null)
            ) {
              catalogMissing = true
              break
            }
            const detail = summarizeErrorBody(text)
            throw new ValidationError(
              detail
                ? `Model discovery failed (HTTP ${response.status}): ${detail}`
                : `Model discovery failed (HTTP ${response.status})`
            )
          }
          reachedCatalog = true
          catalogMissing = false
          if (text.length > 2_000_000) {
            throw new ValidationError('Model discovery response is too large')
          }

          let payload: unknown
          try {
            payload = JSON.parse(text)
          } catch {
            throw new ValidationError('Model discovery endpoint returned invalid JSON')
          }
          for (const model of parseDiscoveredModels(payload)) {
            if (!models.has(model.id)) models.set(model.id, model)
            if (models.size >= 2_000) break
          }

          const next = nextModelListPage(input.protocol, url, payload)
          if (!next) break
          url = next
        }

        if (reachedCatalog) break
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new ValidationError('Model discovery request timed out')
      }
      if (error instanceof ValidationError) throw error
      throw new ValidationError(
        `Model discovery request failed: ${redactSecretText((error as Error).message)}`
      )
    } finally {
      clearTimeout(timer)
    }

    if (catalogMissing && models.size === 0) return []
    return [...models.values()]
  }

  async testConnection(input: {
    providerKey: string
    modelId?: string
  }): Promise<ConnectionTestResult> {
    const started = Date.now()
    const provider = await this.get(input.providerKey)
    const resolvedModelId =
      (input.modelId?.trim() || null) ??
      provider?.defaultModelId ??
      (await this.firstModelId(input.providerKey))
    const base = {
      endpoint: null as string | null,
      protocol: provider?.protocol ?? null,
      modelId: resolvedModelId
    }
    if (!provider) {
      return {
        ok: false,
        status: 'unknown_error',
        httpStatus: null,
        latencyMs: 0,
        message: `Provider not found: ${input.providerKey}`,
        ...base
      }
    }
    if (!provider.baseUrl) {
      return {
        ok: false,
        status: 'endpoint_error',
        httpStatus: null,
        latencyMs: Date.now() - started,
        message: 'Base URL is empty',
        ...base
      }
    }
    if (!resolvedModelId) {
      return {
        ok: false,
        status: 'model_not_found',
        httpStatus: null,
        latencyMs: Date.now() - started,
        message: 'Model ID required — enter a model id to run a real chat probe',
        ...base
      }
    }

    const proto = getProtocol(provider.protocol)
    const normalized = normalizeProviderBaseUrl(provider.baseUrl)
    const root = normalized.url.replace(/\/+$/, '')

    let apiKey: string | null = null
    try {
      apiKey = await resolveCredentialForTest(provider)
    } catch (err) {
      return {
        ok: false,
        status: 'auth_error',
        httpStatus: null,
        latencyMs: Date.now() - started,
        message: `Credential resolve failed: ${redactSecretText((err as Error).message)}`,
        ...base
      }
    }

    if (!apiKey && provider.apiKey) {
      return {
        ok: false,
        status: 'auth_error',
        httpStatus: null,
        latencyMs: Date.now() - started,
        message: 'No API key resolved for this provider. Re-enter the key and save.',
        ...base
      }
    }

    const probe = buildChatProbe(
      provider.protocol,
      root,
      resolvedModelId,
      apiKey,
      provider.authHeader
    )
    base.endpoint = redactSecretText(probe.url)

    const headers: Record<string, string> = {
      ...provider.headers,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...probe.headers
    }
    // Probe already set Authorization / x-api-key when needed. Only fill Bearer
    // as a last resort for protocols that didn't set auth themselves.
    if (apiKey && provider.authHeader && !headers.Authorization && !headers['x-api-key']) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), provider.timeout ?? 30_000)
    try {
      const res = await fetch(probe.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(probe.body),
        signal: controller.signal
      })
      const latencyMs = Date.now() - started
      const bodyText = await res.text().catch(() => '')
      const bodySnippet = summarizeErrorBody(bodyText)

      const mapped = mapHttpStatus(res.status, proto?.label ?? provider.protocol, bodySnippet)
      if (mapped) {
        let message = mapped.message
        if (normalized.changed) {
          message +=
            ' Tip: Base URL should be the API root (e.g. …/v1), not …/chat/completions — Pi appends the path.'
        }
        return { ...mapped, latencyMs, message, ...base }
      }

      // 2xx — verify it looks like a chat response (not an HTML login page etc.)
      if (res.status >= 200 && res.status < 300) {
        const errInBody = extractApiError(bodyText)
        if (errInBody) {
          return {
            ok: false,
            status: 'model_error',
            httpStatus: res.status,
            latencyMs,
            message: errInBody,
            ...base
          }
        }
        return {
          ok: true,
          status: 'success',
          httpStatus: res.status,
          latencyMs,
          message: normalized.changed
            ? `Chat OK (${latencyMs}ms). Note: Base URL was normalized — save the provider to persist.`
            : `Chat OK (${latencyMs}ms) — model responded`,
          ...base
        }
      }

      return {
        ok: false,
        status: 'endpoint_error',
        httpStatus: res.status,
        latencyMs,
        message: bodySnippet
          ? `HTTP ${res.status}: ${bodySnippet}`
          : `HTTP ${res.status} from ${proto?.label ?? provider.protocol}`,
        ...base
      }
    } catch (err) {
      const latencyMs = Date.now() - started
      const name = (err as Error).name
      if (name === 'AbortError') {
        return {
          ok: false,
          status: 'timeout',
          httpStatus: null,
          latencyMs,
          message: 'Request timed out',
          ...base
        }
      }
      log.provider.warn('connection test failed:', err)
      return {
        ok: false,
        status: 'network_error',
        httpStatus: null,
        latencyMs,
        message: redactSecretText((err as Error).message),
        ...base
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private parseForm(raw: unknown): ProviderForm {
    const r = providerFormSchema.safeParse(raw)
    if (!r.success) {
      throw new ValidationError('Invalid provider form', { issues: r.error.issues })
    }
    const data = r.data
    const { url } = normalizeProviderBaseUrl(data.baseUrl)
    return { ...data, baseUrl: url }
  }

  private async firstModelId(providerKey: string): Promise<string | null> {
    const snap = await this.config.read()
    const models = snap.models.providers[providerKey]?.models ?? []
    return models[0]?.id ?? null
  }

  private async persistSecret(key: string, apiKey: ProviderForm['apiKey']): Promise<string | null> {
    if (!apiKey) return null
    if (apiKey.kind === 'literal' && apiKey.literal) {
      const id = `prov-${key}-${randomBytes(4).toString('hex')}`
      await secretStore.setSecret(id, apiKey.literal)
      return id
    }
    if (apiKey.kind === 'stored') {
      // already stored — no new id
      return null
    }
    return null
  }
}

/**
 * Provider metadata can briefly lag behind models.json while providers are
 * created, renamed, or added outside Pi-Harness. Resolve that partial state to
 * a deterministic single selection before it reaches the renderer.
 */
export function resolveEnabledProviderKey(
  providerKeys: string[],
  providersMeta: AppMetadata['providers'],
  activeProviderKey: string | null
): string | null {
  const configured = new Set(providerKeys)
  const explicitlyEnabled = providerKeys.filter((key) => providersMeta[key]?.enabled === true)

  if (explicitlyEnabled.length > 0) {
    if (activeProviderKey && explicitlyEnabled.includes(activeProviderKey)) {
      return activeProviderKey
    }
    return explicitlyEnabled[0] ?? null
  }

  const untracked = providerKeys.filter((key) => providersMeta[key]?.enabled === undefined)
  if (
    activeProviderKey &&
    configured.has(activeProviderKey) &&
    untracked.includes(activeProviderKey)
  ) {
    return activeProviderKey
  }
  return untracked[0] ?? null
}

async function resolveDiscoveryCredential(
  draft: ProviderForm['apiKey'],
  existing: ProviderProfile | null
): Promise<string | null> {
  if (!draft) return null
  if (draft.kind === 'literal') {
    const literal = draft.literal?.trim()
    return literal || (existing ? resolveCredentialForTest(existing) : null)
  }
  if (draft.kind === 'env') {
    const name = draft.envRef
      ?.trim()
      .replace(/^\$\{?/, '')
      .replace(/\}$/, '')
    if (!name) return null
    const value = process.env[name]?.trim()
    if (!value) throw new ValidationError(`Environment variable is empty or missing: ${name}`)
    return value
  }
  if (draft.kind === 'stored') {
    if (!existing) throw new ValidationError('Save the API key before discovering models')
    return resolveCredentialForTest(existing)
  }
  if (draft.kind === 'command') {
    if (
      !existing ||
      existing.apiKey?.kind !== 'command' ||
      existing.apiKey.command !== draft.command
    ) {
      throw new ValidationError(
        'Save the provider before using a command credential to discover models'
      )
    }
    return resolveCredentialForTest(existing)
  }
  return null
}

const MISSING_MODEL_CATALOG_STATUSES = new Set([404, 405, 501])

function isMissingModelCatalogStatus(status: number): boolean {
  return MISSING_MODEL_CATALOG_STATUSES.has(status)
}

function anthropicAuthHeaders(apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' }
  if (!apiKey) return headers
  // Native Anthropic wants x-api-key; Volcengine / many CN gateways want Bearer.
  headers['x-api-key'] = apiKey
  headers.Authorization = `Bearer ${apiKey}`
  return headers
}

function openaiAuthHeaders(apiKey: string | null): Record<string, string> {
  if (!apiKey) return {}
  return { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey }
}

function buildModelListRequest(
  protocol: ProviderModelDiscoveryInput['protocol'],
  root: URL,
  apiKey: string | null,
  authHeader: boolean
): { url: URL; headers: Record<string, string> } {
  const url = new URL(root.toString())
  const headers: Record<string, string> = {}
  const path = url.pathname.replace(/\/+$/, '')

  if (protocol === 'anthropic-messages') {
    url.pathname = `${path.endsWith('/v1') ? path : `${path}/v1`}/models`
    url.searchParams.set('limit', '100')
    Object.assign(headers, anthropicAuthHeaders(apiKey))
    return { url, headers }
  }

  url.pathname = `${path}/models`
  if (protocol === 'google-generative-ai') {
    url.searchParams.set('pageSize', '1000')
    if (apiKey) url.searchParams.set('key', apiKey)
  } else if (apiKey && authHeader) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return { url, headers }
}

/**
 * Anthropic-compatible CN gateways (Volcengine Ark Agent/Coding Plan) implement
 * POST /v1/messages but not GET /v1/models. Try OpenAI-style siblings before failing.
 */
function buildModelListCandidates(
  protocol: ProviderModelDiscoveryInput['protocol'],
  root: URL,
  apiKey: string | null,
  authHeader: boolean
): { url: URL; headers: Record<string, string> }[] {
  const primary = buildModelListRequest(protocol, root, apiKey, authHeader)
  if (protocol !== 'anthropic-messages') return [primary]

  const path = root.pathname.replace(/\/+$/, '')
  const candidates = [primary]
  const seen = new Set([primary.url.pathname])
  const openaiHeaders = openaiAuthHeaders(apiKey)

  const push = (pathname: string): void => {
    if (seen.has(pathname)) return
    seen.add(pathname)
    const url = new URL(root.toString())
    url.pathname = pathname
    candidates.push({ url, headers: openaiHeaders })
  }

  push(`${path}/models`)
  if (/(?:^|\/)api\/(?:plan|coding)$/i.test(path)) {
    push(`${path}/v3/models`)
  }
  return candidates
}

function nextModelListPage(
  protocol: ProviderModelDiscoveryInput['protocol'],
  currentUrl: URL,
  payload: unknown
): URL | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const page = payload as Record<string, unknown>
  const next = new URL(currentUrl.toString())

  if (protocol === 'google-generative-ai') {
    const token = page.nextPageToken
    if (typeof token !== 'string' || !token) return null
    next.searchParams.set('pageToken', token)
    return next
  }

  if (protocol === 'anthropic-messages' && page.has_more === true) {
    const data = Array.isArray(page.data) ? page.data : []
    const lastItem = data.at(-1)
    const lastId =
      typeof page.last_id === 'string'
        ? page.last_id
        : lastItem && typeof lastItem === 'object' && typeof lastItem.id === 'string'
          ? lastItem.id
          : ''
    if (!lastId) return null
    next.searchParams.set('after_id', lastId)
    return next
  }
  return null
}

function parseDiscoveredModels(payload: unknown): DiscoveredProviderModel[] {
  let entries: unknown[] = []
  if (Array.isArray(payload)) {
    entries = payload
  } else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data)) entries = record.data
    else if (Array.isArray(record.models)) entries = record.models
  }

  const models: DiscoveredProviderModel[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const id = entry.trim().replace(/^models\//, '')
      if (id && id.length <= 256) models.push({ id, name: id })
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const rawId =
      typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : ''
    const id = rawId.trim().replace(/^models\//, '')
    if (!id || id.length > 256) continue
    const rawName =
      typeof item.display_name === 'string'
        ? item.display_name
        : typeof item.displayName === 'string'
          ? item.displayName
          : typeof item.id === 'string' && typeof item.name === 'string'
            ? item.name
            : id
    const name = rawName.trim().slice(0, 256) || id
    models.push({ id, name })
  }
  return models
}

function setHeaderIfMissing(headers: Record<string, string>, name: string, value: string): void {
  if (!Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase())) {
    headers[name] = value
  }
}

function buildChatProbe(
  protocol: string,
  root: string,
  modelId: string,
  apiKey: string | null,
  authHeader: boolean
): { url: string; body: Record<string, unknown>; headers: Record<string, string> } {
  const headers: Record<string, string> = {}

  if (protocol === 'anthropic-messages') {
    // Anthropic SDK / Claude Code / CC Switch append `/v1/messages` to the base.
    // Volcengine Agent Plan expects the same: …/api/plan/v1/messages
    // Auth: native Anthropic uses x-api-key; Volcengine & many gateways want Bearer.
    // Send both when we have a key so either style works.
    headers['anthropic-version'] = '2023-06-01'
    if (apiKey) {
      headers['x-api-key'] = apiKey
      if (authHeader) headers.Authorization = `Bearer ${apiKey}`
    }
    return {
      url: `${root}/v1/messages`,
      headers,
      body: {
        model: modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      }
    }
  }

  if (protocol === 'openai-responses') {
    if (apiKey && authHeader) headers.Authorization = `Bearer ${apiKey}`
    return {
      url: `${root}/responses`,
      headers,
      body: {
        model: modelId,
        max_output_tokens: 1,
        input: 'ping'
      }
    }
  }

  if (protocol === 'google-generative-ai') {
    const encoded = encodeURIComponent(modelId)
    const qs = apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''
    return {
      url: `${root}/models/${encoded}:generateContent${qs}`,
      headers,
      body: {
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1 }
      }
    }
  }

  // openai-completions (default) — same path Pi uses for chat
  if (apiKey && authHeader) headers.Authorization = `Bearer ${apiKey}`
  return {
    url: `${root}/chat/completions`,
    headers,
    body: {
      model: modelId,
      max_tokens: 1,
      stream: false,
      messages: [{ role: 'user', content: 'ping' }]
    }
  }
}

function summarizeErrorBody(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  try {
    const json = JSON.parse(trimmed) as {
      error?: { message?: string; type?: string; code?: string | number }
      message?: string
    }
    const msg = json.error?.message ?? json.message
    if (msg) return redactSecretText(String(msg).slice(0, 240))
  } catch {
    // not JSON
  }
  return redactSecretText(trimmed.replace(/\s+/g, ' ').slice(0, 240))
}

function extractApiError(text: string): string | null {
  const snippet = summarizeErrorBody(text)
  if (!snippet) return null
  try {
    const json = JSON.parse(text) as { error?: unknown }
    if (json.error) return snippet
  } catch {
    return null
  }
  return null
}

function mapHttpStatus(
  status: number,
  protocolLabel: string,
  bodySnippet = ''
): Omit<ConnectionTestResult, 'latencyMs' | 'endpoint' | 'protocol' | 'modelId'> | null {
  const detail = bodySnippet ? `: ${bodySnippet}` : ''
  if (status === 401) {
    return {
      ok: false,
      status: 'auth_error',
      httpStatus: status,
      message: `401 Unauthorized — API key invalid or missing${detail}`
    }
  }
  if (status === 403) {
    return {
      ok: false,
      status: 'forbidden',
      httpStatus: status,
      message: `403 Forbidden — key lacks access to this model/endpoint${detail}`
    }
  }
  if (status === 404) {
    return {
      ok: false,
      status: 'model_not_found',
      httpStatus: status,
      message: `404 Not Found — wrong endpoint or model id${detail}`
    }
  }
  if (status === 429) {
    return {
      ok: false,
      status: 'rate_limited',
      httpStatus: status,
      message: `429 Rate limited — quota exhausted or too many requests${detail}`
    }
  }
  if (status >= 500) {
    return {
      ok: false,
      status: 'endpoint_error',
      httpStatus: status,
      message: `Upstream error HTTP ${status} (${protocolLabel})${detail}`
    }
  }
  if (status >= 400) {
    return {
      ok: false,
      status: 'endpoint_error',
      httpStatus: status,
      message: `HTTP ${status} from ${protocolLabel}${detail}`
    }
  }
  return null
}

/**
 * Resolve a credential for connection tests only (Main process).
 * Never returns values to the renderer. Supports stored / env / command kinds.
 */
async function resolveCredentialForTest(provider: ProviderProfile): Promise<string | null> {
  if (provider.apiKeyRef) {
    const secret = await secretStore.getSecret(provider.apiKeyRef)
    if (secret) return secret
  }
  const spec = provider.apiKey
  if (!spec) return null
  if (spec.kind === 'env' && spec.envRef) {
    const name = spec.envRef.replace(/^\$\{?/, '').replace(/\}$/, '')
    return process.env[name] ?? null
  }
  if (spec.kind === 'command' && spec.command) {
    const cmd = spec.command.startsWith('!') ? spec.command.slice(1) : spec.command
    // Prefer execFile with argv split for keychain; otherwise use shell:false + token split.
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileP = promisify(execFile)
    const parts = cmd.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((p) => p.replace(/^"|"$/g, '')) ?? []
    if (parts.length === 0) return null
    const [bin, ...args] = parts
    const { stdout } = await execFileP(bin!, args, {
      timeout: 8000,
      env: process.env,
      maxBuffer: 64 * 1024
    })
    return String(stdout).trim() || null
  }
  return null
}

function ensureDefaultModel(
  provider: import('@shared/types/pi').PiProviderConfig,
  defaultModelId: string | null,
  protocol: import('@shared/constants/protocols').ProtocolId,
  catalogModel: {
    id: string
    name: string
    contextWindow: number | null
    maxOutputTokens: number | null
  } | null
): import('@shared/types/pi').PiProviderConfig {
  const id = defaultModelId?.trim()
  if (!id) return provider
  const models = [...(provider.models ?? [])]
  const catalog = catalogModel?.id === id ? catalogModel : null
  const existingIndex = models.findIndex((model) => model.id === id)
  if (existingIndex >= 0) {
    const existing = models[existingIndex]!
    models[existingIndex] = {
      ...existing,
      name: catalog?.name || existing.name || id,
      contextWindow: catalog?.contextWindow ?? existing.contextWindow,
      maxTokens: catalog?.maxOutputTokens ?? existing.maxTokens
    }
    return { ...provider, models }
  }
  models.push(
    domainModelToPi(undefined, {
      modelId: id,
      displayName: catalog?.name || id,
      protocol,
      reasoning: false,
      vision: false,
      contextWindow: catalog?.contextWindow ?? null,
      maxOutputTokens: catalog?.maxOutputTokens ?? null
    })
  )
  return { ...provider, models }
}

function mergeDiscoveredModels(
  provider: PiProviderConfig,
  discovered: DiscoveredProviderModel[],
  protocol: ProviderModelDiscoveryInput['protocol']
): PiProviderConfig {
  if (discovered.length === 0) return provider
  const models = [...(provider.models ?? [])]
  const existingIds = new Set(models.map((model) => model.id))
  for (const model of discovered) {
    const id = model.id.trim()
    if (!id || existingIds.has(id)) continue
    models.push(
      domainModelToPi(undefined, {
        modelId: id,
        displayName: model.name.trim() || id,
        protocol,
        reasoning: false,
        vision: false,
        contextWindow: null,
        maxOutputTokens: null
      })
    )
    existingIds.add(id)
  }
  return { ...provider, models }
}
