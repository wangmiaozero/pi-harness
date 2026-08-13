/**
 * ProviderService — CRUD over Pi models.json providers + Pi-Switch metadata.
 */

import type { ProviderProfile } from '@shared/types/domain'
import type { ProviderForm } from '@shared/schemas/domain'
import { providerFormSchema } from '@shared/schemas/domain'
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
import { log } from '../services/logger'
import { normalizeProviderBaseUrl } from '@shared/utils/base-url'

export class ProviderService {
  constructor(
    private readonly config: PiConfigService,
    private readonly metadata: JsonStore<AppMetadata>
  ) {}

  async list(): Promise<ProviderProfile[]> {
    const snap = await this.config.read()
    const meta = await this.metadata.read()
    return Object.entries(snap.models.providers).map(([key, pi]) =>
      providerToDomain(key, pi, meta.providers[key])
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
        return ensureDefaultModel(next, form.defaultModelId ?? null, form.protocol)
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
    const form = this.parseForm({ ...(raw as object), key })
    const current = await this.get(key)
    if (!current) throw new NotFoundError(`Provider not found: ${key}`)

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

    await this.config.patchProvider(
      key,
      (cur) => {
        const next = domainProviderToPi(cur, {
          protocol: form.protocol,
          baseUrl: form.baseUrl,
          headers: form.headers,
          authHeader: form.authHeader,
          apiKeyValue
        })
        return ensureDefaultModel(next, form.defaultModelId ?? null, form.protocol)
      },
      { overwrite: options?.overwrite, reason: `update provider ${key}` }
    )

    const meta = await this.metadata.read()
    const now = Date.now()
    const providersMeta = { ...meta.providers }
    if (form.enabled) {
      for (const k of Object.keys((await this.config.read()).models.providers)) {
        const prev = providersMeta[k] ?? {}
        providersMeta[k] = {
          ...prev,
          enabled: k === key,
          updatedAt: now,
          createdAt: prev.createdAt ?? now
        }
      }
    }
    providersMeta[key] = {
      ...providersMeta[key],
      displayName: form.displayName,
      enabled: form.enabled,
      timeout: form.timeout,
      apiKeyRef: secretId,
      defaultModelId:
        form.defaultModelId !== undefined
          ? form.defaultModelId
          : (meta.providers[key]?.defaultModelId ?? null),
      updatedAt: now,
      createdAt: meta.providers[key]?.createdAt ?? now
    }
    await this.metadata.update({ providers: providersMeta })

    const updated = await this.get(key)
    if (!updated) throw new ValidationError('Provider update failed')
    return updated
  }

  async delete(key: string, options?: WriteOptions): Promise<void> {
    const current = await this.get(key)
    if (!current) throw new NotFoundError(`Provider not found: ${key}`)
    if (current.apiKeyRef) await secretStore.removeSecret(current.apiKeyRef)

    await this.config.patchProvider(key, () => undefined, {
      overwrite: options?.overwrite,
      reason: `delete provider ${key}`
    })

    const meta = await this.metadata.read()
    const providers = { ...meta.providers }
    delete providers[key]
    const models = { ...meta.models }
    for (const k of Object.keys(models)) {
      if (k.startsWith(`${key}::`)) delete models[k]
    }
    await this.metadata.write({ providers, models })
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

  /** Quick enable toggle — at most one provider may be enabled. */
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
    const updated = await this.get(key)
    if (!updated) throw new ValidationError('setEnabled failed')
    return updated
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

    const proto = getProtocol(provider.protocol)
    const normalized = normalizeProviderBaseUrl(provider.baseUrl)
    let url = normalized.url
    // Protocol-driven probe: openai-family → /models; others → base URL.
    if (provider.protocol === 'openai-completions' || provider.protocol === 'openai-responses') {
      url = `${url}/models`
    }
    base.endpoint = url

    let apiKey: string | null = null
    try {
      apiKey = await resolveCredentialForTest(provider)
    } catch (err) {
      return {
        ok: false,
        status: 'auth_error',
        httpStatus: null,
        latencyMs: Date.now() - started,
        message: `Credential resolve failed: ${(err as Error).message}`,
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

    const headers: Record<string, string> = { ...provider.headers, Accept: 'application/json' }
    if (apiKey && provider.authHeader) headers.Authorization = `Bearer ${apiKey}`
    if (provider.protocol === 'anthropic-messages' && apiKey) {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), provider.timeout ?? 15_000)
    try {
      const res = await fetch(url, { method: 'GET', headers, signal: controller.signal })
      const latencyMs = Date.now() - started
      const mapped = mapHttpStatus(res.status, proto?.label ?? provider.protocol)
      if (mapped) {
        let message = mapped.message
        if (normalized.changed) {
          message +=
            ' Tip: Base URL should be the API root (e.g. …/v1), not …/chat/completions — Pi appends the path.'
        }
        return { ...mapped, latencyMs, message, ...base }
      }
      // Soft-validate JSON body when content-type looks like JSON
      const ctype = res.headers.get('content-type') ?? ''
      if (ctype.includes('application/json')) {
        try {
          await res.json()
        } catch {
          return {
            ok: false,
            status: 'invalid_response',
            httpStatus: res.status,
            latencyMs,
            message: 'Response claimed JSON but failed to parse',
            ...base
          }
        }
      }
      return {
        ok: true,
        status: 'success',
        httpStatus: res.status,
        latencyMs,
        message: normalized.changed
          ? `Reachable (${latencyMs}ms). Note: Base URL was normalized (dropped …/chat/completions). Save the provider to persist.`
          : `Reachable (${latencyMs}ms)`,
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
        message: (err as Error).message,
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

function mapHttpStatus(
  status: number,
  protocolLabel: string
): Omit<ConnectionTestResult, 'latencyMs' | 'endpoint' | 'protocol' | 'modelId'> | null {
  if (status === 401) {
    return {
      ok: false,
      status: 'auth_error',
      httpStatus: status,
      message: `Authentication failed (${status})`
    }
  }
  if (status === 403) {
    return {
      ok: false,
      status: 'forbidden',
      httpStatus: status,
      message: `Forbidden (${status})`
    }
  }
  if (status === 404) {
    return {
      ok: false,
      status: 'model_not_found',
      httpStatus: status,
      message: `Not found (${status}) — endpoint or model may be wrong`
    }
  }
  if (status === 429) {
    return {
      ok: false,
      status: 'rate_limited',
      httpStatus: status,
      message: `Rate limited (${status})`
    }
  }
  if (status >= 500) {
    return {
      ok: false,
      status: 'endpoint_error',
      httpStatus: status,
      message: `Upstream error HTTP ${status} (${protocolLabel})`
    }
  }
  if (status >= 400) {
    return {
      ok: false,
      status: 'endpoint_error',
      httpStatus: status,
      message: `HTTP ${status} from ${protocolLabel}`
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
  protocol: import('@shared/constants/protocols').ProtocolId
): import('@shared/types/pi').PiProviderConfig {
  const id = defaultModelId?.trim()
  if (!id) return provider
  const models = [...(provider.models ?? [])]
  if (models.some((m) => m.id === id)) return { ...provider, models }
  models.push(
    domainModelToPi(undefined, {
      modelId: id,
      displayName: id,
      protocol,
      reasoning: false,
      vision: false,
      contextWindow: null,
      maxOutputTokens: null
    })
  )
  return { ...provider, models }
}
