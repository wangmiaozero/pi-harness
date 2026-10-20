import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { OpenCodeFreeState, OpenCodeModel } from '@shared/providers/opencode-free'
import { JsonStore } from './storage'
import type { AppMetadata } from './metadata-store'
import type { PiConfigService } from '../pi/config-service'
import { secretStore } from '../security/secret-store'
import { ValidationError } from './errors'
import { loadPiCodingAgent } from '../agent/pi-sdk'
import {
  BASE,
  ID,
  request,
  boundedText,
  fetchCatalog,
  errorCode,
  assertAllowed,
  authorizedAccess,
  serviceBase,
  safeErrorCode
} from '../../../resources/desktop-extension/opencode-catalog.mjs'
import {
  runtimeModels,
  credentialSlot
} from '../../../resources/desktop-extension/opencode-state.mjs'
import metadata from '../../../resources/desktop-extension/opencode-models.json'

export const openCodeConfigureSchema = z
  .object({
    enabled: z.boolean(),
    authMode: z.literal('inference'),
    removeCredential: z.boolean().optional(),
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .regex(/^[^\r\n]+$/)
      .optional(),
    consent: z.literal(true)
  })
  .strict()
export const openCodeModelSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
export const initialOpenCodeState = (): OpenCodeFreeState => ({
  schemaVersion: 2,
  enabled: false,
  showInWorkspace: false,
  workspaceModelIds: [],
  authMode: 'inference',
  connectionStatus: 'NOT_CONFIGURED',
  httpStatus: null,
  allowedPaidModels: [],
  authorizedModels: [],
  hasCredential: false,
  selectedModel: null,
  refreshedAt: null,
  error: null,
  models: []
})
export const openCodeWorkspaceSchema = z
  .object({
    showInWorkspace: z.boolean(),
    modelIds: z.array(openCodeModelSchema).max(200)
  })
  .strict()
export const openCodeCredentialIdSchema = z
  .string()
  .regex(/^(?:default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/)
export const openCodeCredentialSchema = z
  .object({
    id: openCodeCredentialIdSchema.optional(),
    name: z.string().trim().min(1).max(80),
    apiKey: openCodeConfigureSchema.shape.apiKey,
    consent: z.literal(true)
  })
  .strict()
function invalidateCredential(state: OpenCodeFreeState): OpenCodeFreeState {
  return {
    ...state,
    authorizedModels: [],
    allowedPaidModels: [],
    connectionStatus: 'CONFIGURED',
    httpStatus: null,
    error: null,
    models: state.models.map((m) => ({
      ...m,
      status: m.available ? 'not_verified' : 'unavailable',
      streaming: 'not_verified',
      tools: 'not_verified',
      checkedAt: null,
      errorCode: null
    }))
  }
}
export const openCodeTestSchema = z
  .object({
    confirmInference: z.literal(true),
    allowPaid: z.boolean().optional(),
    credentialId: openCodeCredentialIdSchema.optional(),
    expectedService: z.enum(['zen', 'go']).optional(),
    expectedCost: z
      .object({
        input: z.number().finite().nonnegative(),
        output: z.number().finite().nonnegative(),
        cacheRead: z.number().finite().nonnegative(),
        cacheWrite: z.number().finite().nonnegative()
      })
      .strict()
      .optional()
  })
  .strict()
const diagnostic = safeErrorCode

/** Own cache/consent/verification metadata; only native model fields are written to Pi. */
export class OpenCodeFreeService {
  private readonly store: JsonStore<OpenCodeFreeState>
  private incompatible = false
  private migration: Promise<void> | null = null
  private changingCredential = false
  private controller: AbortController | null = null
  private refreshPromise: Promise<OpenCodeFreeState> | null = null
  private cancellationGeneration = 0
  constructor(
    private readonly file: string,
    private readonly config: PiConfigService,
    private readonly appMetadata: JsonStore<AppMetadata>,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.store = new JsonStore(file, initialOpenCodeState())
  }
  async state(): Promise<OpenCodeFreeState> {
    if (!this.migration) this.migration = this.migrate()
    await this.migration
    const stored = await this.store.read()
    const state = {
      ...stored,
      showInWorkspace: stored.showInWorkspace === true,
      workspaceModelIds: Array.isArray(stored.workspaceModelIds)
        ? stored.workspaceModelIds.filter((id) => typeof id === 'string')
        : []
    }
    if (
      state.schemaVersion !== 2 ||
      !Array.isArray(state.models) ||
      !['inference', 'zen'].includes(state.authMode)
    ) {
      this.incompatible = true
      return { ...initialOpenCodeState(), error: 'CACHE_INCOMPATIBLE' }
    }
    // Read old Zen metadata without exposing its credentials or offering it as a connection.
    if (state.authMode === 'zen')
      return structuredClone({
        ...state,
        enabled: false,
        hasCredential: false,
        connectionStatus: 'NOT_CONFIGURED'
      })
    let hasCredential: boolean
    try {
      hasCredential =
        state.hasCredential &&
        Boolean(await secretStore.getSecret(credentialSlot(state), { strict: true }))
    } catch {
      return structuredClone({
        ...state,
        enabled: false,
        hasCredential: false,
        connectionStatus: 'SECURE_STORAGE_UNAVAILABLE',
        error: 'SECURE_STORAGE_UNAVAILABLE'
      })
    }
    return structuredClone({
      ...state,
      hasCredential,
      connectionStatus: hasCredential ? state.connectionStatus : 'NOT_CONFIGURED',
      models: state.models.map((m) =>
        (!hasCredential || Date.now() - (state.refreshedAt ?? 0) >= 86400000) &&
        m.status === 'ready'
          ? { ...m, status: 'not_verified', streaming: 'not_verified', tools: 'not_verified' }
          : m
      )
    })
  }
  private async migrate(): Promise<void> {
    const old = (await this.store.read()) as unknown as Record<string, unknown>
    if (old.schemaVersion === 2) {
      if (!Array.isArray(old.credentials)) {
        const hasLegacy = old.hasCredential === true && old.authMode === 'inference'
        await fs.mkdir(path.dirname(this.file), { recursive: true })
        const backup = { ...old }
        delete backup.apiKey
        await fs
          .writeFile(`${this.file}.single-key.bak`, JSON.stringify(backup), {
            flag: 'wx',
            mode: 0o600
          })
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'EEXIST') throw error
          })
        await this.store.write({
          ...(old as unknown as OpenCodeFreeState),
          credentials: hasLegacy ? [{ id: 'default', name: 'OpenCode' }] : [],
          activeCredentialId: hasLegacy ? 'default' : null
        })
      }
      return
    }
    if (old.schemaVersion !== 1) return
    // The old store contains only catalog/verification metadata, never a credential.
    // Keep a one-time metadata backup; native sessions/models are never rewritten by migration.
    const backup = { ...old }
    delete backup.apiKey
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await fs
      .writeFile(`${this.file}.v1.bak`, JSON.stringify(backup, null, 2), {
        flag: 'wx',
        mode: 0o600
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
    const official = old.authMode === 'official-api-key' && old.hasCredential === true
    await this.store.write({
      ...initialOpenCodeState(),
      enabled: official && old.enabled === true,
      hasCredential: official,
      credentials: official ? [{ id: 'default', name: 'OpenCode' }] : [],
      activeCredentialId: official ? 'default' : null,
      connectionStatus: official ? 'CONFIGURED' : 'NOT_CONFIGURED',
      selectedModel: typeof old.selectedModel === 'string' ? old.selectedModel : null,
      refreshedAt: typeof old.refreshedAt === 'number' ? old.refreshedAt : null,
      models: Array.isArray(old.models)
        ? old.models.map((m) => ({
            ...m,
            api: null,
            cost: null,
            status: m.available ? 'not_verified' : 'unavailable',
            streaming: 'not_verified',
            tools: 'not_verified',
            checkedAt: null,
            errorCode: null
          }))
        : []
    })
  }
  cancel(): void {
    this.cancellationGeneration++
    this.controller?.abort()
  }
  private async operation(
    work: (signal: AbortSignal) => Promise<void>
  ): Promise<OpenCodeFreeState> {
    const generation = this.cancellationGeneration
    await this.state()
    if (generation !== this.cancellationGeneration) throw new ValidationError('REQUEST_CANCELLED')
    if (this.incompatible) throw new ValidationError('CACHE_INCOMPATIBLE')
    if (this.controller || this.changingCredential)
      throw new ValidationError('OPERATION_IN_PROGRESS')
    const controller = new AbortController()
    this.controller = controller
    try {
      await work(AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]))
    } catch (err) {
      const current = await this.state()
      await this.store.write({
        ...current,
        error: controller.signal.aborted ? 'REQUEST_CANCELLED' : diagnostic(err),
        httpStatus:
          typeof (err as { httpStatus?: number })?.httpStatus === 'number'
            ? (err as { httpStatus: number }).httpStatus
            : null,
        connectionStatus: diagnostic(err),
        authorizedModels: [],
        models: current.models.map((m) => ({
          ...m,
          status: m.available ? 'not_verified' : 'unavailable',
          streaming: 'not_verified',
          tools: 'not_verified'
        }))
      })
      await this.syncConfig(await this.state())
    } finally {
      this.controller = null
    }
    return this.state()
  }
  private async changeCredentials(
    work: () => Promise<OpenCodeFreeState>
  ): Promise<OpenCodeFreeState> {
    if (this.controller || this.changingCredential)
      throw new ValidationError('OPERATION_IN_PROGRESS')
    this.changingCredential = true
    try {
      return await work()
    } finally {
      this.changingCredential = false
    }
  }
  async configure(input: unknown): Promise<OpenCodeFreeState> {
    return this.changeCredentials(() => this.configureCurrent(input))
  }
  private async configureCurrent(input: unknown): Promise<OpenCodeFreeState> {
    const form = openCodeConfigureSchema.parse(input)
    if (this.controller) throw new ValidationError('OPERATION_IN_PROGRESS')
    let state = await this.state()
    if (this.incompatible) throw new ValidationError('CACHE_INCOMPATIBLE')
    if (form.apiKey && form.removeCredential) throw new ValidationError('INVALID_CREDENTIAL_ACTION')
    if (form.apiKey && !state.activeCredentialId)
      state = {
        ...state,
        activeCredentialId: 'default',
        credentials: [...(state.credentials ?? []), { id: 'default', name: 'OpenCode' }]
      }
    if (form.apiKey || form.removeCredential) {
      state = invalidateCredential(state)
      await this.store.write(state)
    }
    if (form.apiKey)
      await secretStore.setSecret(credentialSlot(state), form.apiKey, { strict: true })
    if (form.removeCredential && state.activeCredentialId)
      await secretStore.removeSecret(credentialSlot(state), { strict: true })
    const hasCredential =
      !form.removeCredential &&
      (Boolean(form.apiKey) ||
        (form.authMode === state.authMode &&
          state.hasCredential &&
          Boolean(await secretStore.getSecret(credentialSlot(state), { strict: true }))))
    const changed =
      form.authMode !== state.authMode || Boolean(form.apiKey) || Boolean(form.removeCredential)

    state = {
      ...state,
      enabled: form.enabled && hasCredential,
      authMode: form.authMode,
      hasCredential,
      connectionStatus: hasCredential ? 'CONFIGURED' : 'NOT_CONFIGURED',
      httpStatus: null,
      allowedPaidModels: changed ? [] : state.allowedPaidModels,
      error: hasCredential ? null : 'NOT_CONFIGURED',
      models: changed
        ? state.models.map((m) => ({
            ...m,
            status: m.available ? 'not_verified' : 'unavailable',
            streaming: 'not_verified',
            tools: 'not_verified',
            checkedAt: null,
            errorCode: null
          }))
        : state.models
    }
    if (changed) state.authorizedModels = []
    if (form.removeCredential)
      state = {
        ...state,
        credentials: state.credentials?.filter((key) => key.id !== state.activeCredentialId),
        activeCredentialId: null
      }
    await this.store.write(state)
    await this.syncConfig(state)
    return state
  }
  async saveCredential(input: unknown): Promise<OpenCodeFreeState> {
    const form = openCodeCredentialSchema.parse(input)
    return this.changeCredentials(async () => {
      let state = await this.state()
      if (this.incompatible) throw new ValidationError('CACHE_INCOMPATIBLE')
      const existing = form.id ? state.credentials?.find((key) => key.id === form.id) : undefined
      if (form.id && !existing) throw new ValidationError('CREDENTIAL_NOT_FOUND')
      if (!existing && !form.apiKey) throw new ValidationError('NOT_CONFIGURED')
      if (!existing && (state.credentials?.length ?? 0) >= 50)
        throw new ValidationError('CREDENTIAL_LIMIT')
      const id = existing?.id ?? randomUUID()
      const firstActive = !state.activeCredentialId
      const active = state.activeCredentialId === id || firstActive
      if (form.apiKey && active) {
        state = invalidateCredential(state)
        await this.store.write(state)
      }
      if (form.apiKey)
        await secretStore.setSecret(credentialSlot({ activeCredentialId: id }), form.apiKey, {
          strict: true
        })
      const credentials = existing
        ? state.credentials!.map((key) => (key.id === id ? { ...key, name: form.name } : key))
        : [...(state.credentials ?? []), { id, name: form.name }]
      state = { ...state, credentials }
      if (active)
        state = {
          ...state,
          enabled: firstActive ? true : state.enabled,
          activeCredentialId: id,
          hasCredential: true,
          authMode: 'inference'
        }
      await this.store.write(state)
      await this.syncConfig(state)
      return this.state()
    })
  }
  async activateCredential(input: unknown): Promise<OpenCodeFreeState> {
    const id = openCodeCredentialIdSchema.parse(input)
    return this.changeCredentials(async () => {
      let state = await this.state()
      if (!state.credentials?.some((key) => key.id === id))
        throw new ValidationError('CREDENTIAL_NOT_FOUND')
      if (state.activeCredentialId === id && state.enabled) return state
      if (
        !(await secretStore.getSecret(credentialSlot({ activeCredentialId: id }), { strict: true }))
      )
        throw new ValidationError('NOT_CONFIGURED')
      state = {
        ...(state.activeCredentialId === id ? state : invalidateCredential(state)),
        enabled: true,
        activeCredentialId: id,
        hasCredential: true,
        authMode: 'inference'
      }
      await this.store.write(state)
      await this.syncConfig(state)
      return this.state()
    })
  }
  async deleteCredential(input: unknown): Promise<OpenCodeFreeState> {
    const id = openCodeCredentialIdSchema.parse(input)
    return this.changeCredentials(async () => {
      let state = await this.state()
      if (!state.credentials?.some((key) => key.id === id))
        throw new ValidationError('CREDENTIAL_NOT_FOUND')
      if (state.activeCredentialId === id) {
        state = { ...invalidateCredential(state), enabled: false, hasCredential: false }
        await this.store.write(state)
      }
      await secretStore.removeSecret(credentialSlot({ activeCredentialId: id }), { strict: true })
      state = {
        ...state,
        credentials: state.credentials?.filter((key) => key.id !== id),
        ...(state.activeCredentialId === id
          ? { activeCredentialId: null, connectionStatus: 'NOT_CONFIGURED' }
          : {})
      }
      await this.store.write(state)
      await this.syncConfig(state)
      return this.state()
    })
  }
  async revealCredential(input: unknown): Promise<string> {
    const id = openCodeCredentialIdSchema.parse(input)
    const state = await this.state()
    if (!state.credentials?.some((key) => key.id === id))
      throw new ValidationError('CREDENTIAL_NOT_FOUND')
    const key = await secretStore.getSecret(credentialSlot({ activeCredentialId: id }), {
      strict: true
    })
    if (!key) throw new ValidationError('NOT_CONFIGURED')
    return key
  }
  async setWorkspaceVisibility(input: unknown): Promise<OpenCodeFreeState> {
    const form = openCodeWorkspaceSchema.parse(input)
    return this.changeCredentials(async () => {
      const state = await this.state()
      if (this.incompatible) throw new ValidationError('CACHE_INCOMPATIBLE')
      if (form.showInWorkspace && !state.hasCredential) throw new ValidationError('NOT_CONFIGURED')
      const ids = [...new Set(form.modelIds)]
      const previousIds = new Set(state.workspaceModelIds ?? [])
      // Catalog changes must not let an older preference block unrelated additions or hiding.
      // Retaining a preference grants no runtime proof or permission to send requests.
      if (
        ids.some(
          (id) =>
            !previousIds.has(id) &&
            !state.models.some((model) => model.id === id && model.price !== 'unknown')
        )
      )
        throw new ValidationError('MODEL_UNAVAILABLE')
      const next = { ...state, showInWorkspace: form.showInWorkspace, workspaceModelIds: ids }
      await this.store.write(next)
      return this.state()
    })
  }
  refresh(): Promise<OpenCodeFreeState> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.refreshCatalog().finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }
  private refreshCatalog(): Promise<OpenCodeFreeState> {
    return this.operation(async (signal) => {
      const state = await this.state()
      if (state.authMode !== 'inference') throw new Error('NOT_VERIFIED')
      const key = state.hasCredential
        ? await secretStore.getSecret(credentialSlot(state), { strict: true })
        : null
      const access = key
        ? await authorizedAccess(key, signal, this.fetcher)
        : { modelIds: [], routes: {} as Record<string, 'zen' | 'go'> }
      const permitted = access.modelIds
      const zen = await fetchCatalog(state.models, signal, this.fetcher)
      const go = Object.values(access.routes).includes('go')
        ? await fetchCatalog(
            state.models.filter((m) => m.service === 'go'),
            signal,
            this.fetcher,
            'go'
          )
        : []
      const zenModels = new Map(zen.map((model) => [model.id, model]))
      const goModels = new Map(go.map((model) => [model.id, model]))
      const catalog = [...new Set([...zenModels.keys(), ...goModels.keys()])].map((id) =>
        access.routes[id] === 'go'
          ? (goModels.get(id) ?? {
              ...zenModels.get(id)!,
              service: 'go' as const,
              available: false
            })
          : (zenModels.get(id) ?? goModels.get(id)!)
      )
      const models: OpenCodeModel[] = catalog.map((item) => {
        const old = state.models.find((m) => m.id === item.id)
        const declared = metadata.models.find((m) => m.id === item.id)
        const preserve =
          permitted.includes(item.id) &&
          item.available &&
          old?.available &&
          (item.service ?? 'zen') === (old.service ?? 'zen') &&
          item.price === old.price &&
          item.api === old.api &&
          JSON.stringify(item.cost) === JSON.stringify(old.cost)
        return {
          ...item,
          contextWindow: declared?.contextWindow ?? null,
          maxTokens: declared?.maxTokens ?? null,
          input: declared?.input ?? null,
          reasoning: declared?.reasoning ?? null,
          streaming: preserve ? old.streaming : 'not_verified',
          tools: preserve ? old.tools : 'not_verified',
          checkedAt: old?.checkedAt ?? null,
          status: !item.available ? 'unavailable' : preserve ? old.status : 'not_verified',
          errorCode: preserve ? old.errorCode : null
        }
      })
      const next = {
        ...state,
        models,
        authorizedModels: permitted,
        httpStatus: key ? 200 : null,
        connectionStatus: key ? 'CONNECTED' : 'NOT_CONFIGURED',
        allowedPaidModels: state.allowedPaidModels.filter((id) =>
          models.some((m) => m.id === id && m.status === 'ready')
        ),
        refreshedAt: Date.now(),
        error: null
      }
      await this.store.write(next)
      await this.syncConfig(next)
    })
  }
  async test(id: string, options?: unknown): Promise<OpenCodeFreeState> {
    openCodeModelSchema.parse(id)
    return this.operation(async (signal) => {
      const state = await this.state()
      const key = state.hasCredential
        ? await secretStore.getSecret(credentialSlot(state), { strict: true })
        : null
      if (!key) throw new Error('NOT_CONFIGURED')
      if (state.authMode !== 'inference') throw new Error('NOT_VERIFIED')
      if (options === undefined) {
        const permitted = (await authorizedAccess(key, signal, this.fetcher)).modelIds
        await this.store.write({
          ...state,
          authorizedModels: permitted,
          httpStatus: 200,
          connectionStatus: 'CONNECTED',
          error: null,
          models: state.models.map((m) =>
            permitted.includes(m.id)
              ? m
              : { ...m, status: 'not_verified', streaming: 'not_verified', tools: 'not_verified' }
          )
        })
        await this.syncConfig(await this.state())
        return
      }
      if (!state.enabled) throw new Error('PROVIDER_DISABLED')
      const consent = openCodeTestSchema.parse(options)
      if (consent.credentialId && consent.credentialId !== state.activeCredentialId)
        throw new Error('NOT_VERIFIED')
      const entry = state.models.find((m) => m.id === id)
      if (!entry?.available) throw new Error('MODEL_UNAVAILABLE')
      if (consent.expectedService && consent.expectedService !== (entry.service ?? 'zen'))
        throw new Error('NOT_VERIFIED')
      if (
        consent.expectedCost &&
        (!entry.cost ||
          (Object.keys(consent.expectedCost) as (keyof typeof consent.expectedCost)[]).some(
            (field) => consent.expectedCost![field] !== entry.cost![field]
          ))
      )
        throw new Error('PRICE_CHANGED')
      const access = await authorizedAccess(key, signal, this.fetcher)
      const permitted = access.modelIds
      if (!permitted.includes(id)) throw new Error('INSUFFICIENT_PERMISSION')
      if ((entry.service ?? 'zen') !== access.routes[id]) throw new Error('NOT_VERIFIED')
      if (entry.api !== 'openai-completions') throw new Error('PROTOCOL_NOT_VERIFIED')
      if (entry.price === 'unknown') throw new Error('PRICE_UNKNOWN')
      if (entry.price === 'paid' && !consent.allowPaid)
        throw new Error('PAID_AUTHORIZATION_REQUIRED')
      if (!entry.contextWindow || !entry.maxTokens || !entry.input)
        throw new Error('MODEL_METADATA_UNKNOWN')
      const approved =
        entry.price === 'paid'
          ? [...new Set([...state.allowedPaidModels, id])]
          : state.allowedPaidModels
      const probeState = { ...state, allowedPaidModels: approved, authorizedModels: permitted }
      let httpStatus: number | null = null
      let failure: string | null = null
      try {
        // Canned input only; never include user workspace or project data in diagnostics.
        await assertAllowed(id, probeState, signal, this.fetcher)
        // Go probes run as a real Pi session so every inference turn carries its session ID.
        if (entry.service !== 'go') {
          const response = await request(
            `${serviceBase(entry.service)}/chat/completions`,
            {
              method: 'POST',
              signal,
              headers: {
                'content-type': 'application/json',
                ...(key ? { authorization: `Bearer ${key}` } : {})
              },
              body: JSON.stringify({
                model: id,
                stream: false,
                max_tokens: 64,
                messages: [{ role: 'user', content: 'Reply with OK.' }]
              })
            },
            this.fetcher
          )
          httpStatus = response.status
          const text = await boundedText(response, 65536)
          if (!response.ok) throw new Error(errorCode(response.status, text))
          if (!JSON.parse(text).choices?.[0]?.message?.content) throw new Error('INVALID_RESPONSE')
        }
        await verifyNativeToolRoundtrip(probeState, entry, key, signal, async (url, init) => {
          const response = await this.fetcher(url, init)
          if (String(url) === `${serviceBase(entry.service)}/chat/completions`)
            httpStatus = response.status
          return response
        })
      } catch (err) {
        failure = signal.aborted ? 'REQUEST_CANCELLED' : diagnostic(err)
      }
      const next: OpenCodeFreeState = {
        ...state,
        error: failure,
        httpStatus,
        connectionStatus: failure ?? 'CONNECTED',
        authorizedModels: permitted,
        allowedPaidModels: failure ? state.allowedPaidModels.filter((m) => m !== id) : approved,
        models: state.models.map((m) =>
          m.id !== id
            ? failure === 'INVALID_API_KEY'
              ? { ...m, status: 'auth_required', streaming: 'not_verified', tools: 'not_verified' }
              : m
            : {
                ...m,
                available: ['MODEL_UNAVAILABLE', 'MODEL_DEPRECATED'].includes(failure ?? '')
                  ? false
                  : m.available,
                streaming: failure ? 'not_verified' : 'verified',
                tools: failure ? 'not_verified' : 'verified',
                checkedAt: Date.now(),
                errorCode: failure,
                status: !failure
                  ? 'ready'
                  : ['MODEL_UNAVAILABLE', 'MODEL_DEPRECATED'].includes(failure ?? '')
                    ? 'unavailable'
                    : failure === 'FREE_TIER_RESTRICTED'
                      ? 'restricted'
                      : failure === 'INVALID_API_KEY'
                        ? 'auth_required'
                        : 'failed'
              }
        )
      }
      await this.store.write(next)
      await this.syncConfig(next)
    })
  }
  async select(id: string): Promise<OpenCodeFreeState> {
    return this.changeCredentials(async () => {
      const state = await this.state()
      if (!runtimeModels(state).some((m) => m.id === id))
        throw new ValidationError('MODEL_NOT_VERIFIED')
      await this.syncConfig(state)
      await this.config.setActiveModel(ID, id, { reason: 'select OpenCode model' })
      const next = { ...state, selectedModel: id }
      await this.store.write(next)
      return next
    })
  }
  private async syncConfig(state: OpenCodeFreeState): Promise<void> {
    const models = runtimeModels(state)
    const snap = await this.config.read()
    if (!models.length && !snap.models.providers[ID]) return
    await this.config.patchProvider(
      ID,
      (current) => ({
        ...current,
        api: 'openai-completions',
        baseUrl: BASE,
        authHeader: false,
        apiKey: undefined,
        headers: {},
        models: models.map(({ provider: _provider, baseUrl: _url, ...m }) => ({
          ...current?.models?.find((old) => old.id === m.id),
          ...m
        }))
      }),
      { reason: 'sync OpenCode catalog' }
    )
    const meta = await this.appMetadata.read()
    await this.appMetadata.write({
      ...meta,
      providers: {
        ...meta.providers,
        [ID]: {
          ...meta.providers[ID],
          name: 'OpenCode',
          displayName: 'OpenCode',
          enabled: state.enabled,
          apiKeyRef: state.hasCredential ? credentialSlot(state) : null
        }
      }
    })
  }
}

/** Hard gate uses the actual native Pi session and tool loop, never a second agent implementation. */
export async function verifyNativeToolRoundtrip(
  state: OpenCodeFreeState,
  entry: OpenCodeModel,
  key: string | undefined,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const sdk = await loadPiCodingAgent()
  const { createOpenCodeProvider } =
    await import('../../../resources/desktop-extension/opencode-provider.mjs')
  const { Type } = await import('@earendil-works/pi-ai')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-opencode-'))
  let session: import('@earendil-works/pi-coding-agent').AgentSession | undefined
  let executed = 0,
    deltas = 0
  const nonce = randomUUID()
  const probeState: OpenCodeFreeState = {
    ...state,
    enabled: true,
    models: [{ ...entry, status: 'ready', streaming: 'verified', tools: 'verified' }]
  }
  if (!key) throw new Error('NOT_CONFIGURED')
  const provider = createOpenCodeProvider({
    state: async () => probeState,
    fetcher,
    probe: true,
    resolveKey: async () => key
  })
  await provider.refreshModels!({ allowNetwork: false, signal, publish: async () => true })
  // Real credentials remain in this isolated process memory and are never written to the probe directory.
  const originalStream = provider.streamSimple.bind(provider)
  provider.streamSimple = (model, context, options) =>
    originalStream(model, context, { ...options, signal })
  const abort = () => {
    void session?.abort()
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    const settingsManager = sdk.SettingsManager.inMemory({
      defaultProvider: ID,
      defaultModel: entry.id
    })
    const services = await sdk.createAgentSessionServices({
      cwd: dir,
      agentDir: dir,
      settingsManager,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        extensionFactories: [
          {
            name: 'opencode-verification',
            factory: (pi) => {
              pi.registerProvider(provider)
            }
          }
        ],
        systemPromptOverride: () =>
          'Follow the verification request. Only use the provided probe tool.'
      }
    })
    const model = services.modelRuntime.getModel(ID, entry.id)
    if (!model) throw new Error('PI_MODEL_REGISTRATION_FAILED')
    const result = await sdk.createAgentSessionFromServices({
      services,
      model,
      thinkingLevel: 'off',
      sessionManager: sdk.SessionManager.inMemory(dir),
      tools: ['probe_echo'],
      customTools: [
        {
          name: 'probe_echo',
          label: 'Probe',
          description: 'Return the verification nonce.',
          parameters: Type.Object({}),
          execute: async () => {
            executed++
            if (executed > 1) throw new Error('PROBE_TOOL_LIMIT')
            return { content: [{ type: 'text', text: nonce }], details: {} }
          }
        }
      ]
    })
    session = result.session
    session.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta')
        deltas++
    })
    await session.prompt(
      'Call probe_echo once. After reading its result, reply with exactly the returned nonce. Do not invent the nonce.'
    )
    signal.throwIfAborted()
    const messages = session.state.messages
    const final = messages.filter((m) => m.role === 'assistant').at(-1)
    if (
      executed !== 1 ||
      !deltas ||
      final?.role !== 'assistant' ||
      final.stopReason !== 'stop' ||
      !final.content.some((p) => p.type === 'text' && p.text.trim() === nonce)
    )
      throw new Error('PI_TOOL_ROUNDTRIP_NOT_VERIFIED')
  } finally {
    signal.removeEventListener('abort', abort)
    session?.dispose()
    await fs.rm(dir, { recursive: true, force: true })
  }
}
