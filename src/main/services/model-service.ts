/**
 * ModelService — CRUD over models nested under providers in models.json.
 */

import type { ActiveModel, ModelDefinition } from '@shared/types/domain'
import type { ModelForm } from '@shared/schemas/domain'
import { modelFormSchema, setActiveModelSchema } from '@shared/schemas/domain'
import type { JsonStore } from '../services/storage'
import type { AppMetadata } from '../services/metadata-store'
import { modelMetaKey } from '../services/metadata-store'
import { NotFoundError, ValidationError } from '../services/errors'
import type { PiConfigService, WriteOptions } from '../pi/config-service'
import { domainModelToPi, modelToDomain, providerProtocolFromPi } from '../pi/adapter'
import type { PiModelConfig } from '@shared/types/pi'

export class ModelService {
  constructor(
    private readonly config: PiConfigService,
    private readonly metadata: JsonStore<AppMetadata>
  ) {}

  async list(): Promise<ModelDefinition[]> {
    const snap = await this.config.read()
    const meta = await this.metadata.read()
    const out: ModelDefinition[] = []
    for (const [pkey, provider] of Object.entries(snap.models.providers)) {
      const protocol = providerProtocolFromPi(provider.api)
      for (const m of provider.models ?? []) {
        out.push(modelToDomain(pkey, m, protocol, meta.models[modelMetaKey(pkey, m.id)]))
      }
    }
    return out
  }

  async create(raw: unknown, options?: WriteOptions): Promise<ModelDefinition> {
    const form = this.parseForm(raw)
    const providerKey = form.providerId

    await this.config.patchProvider(
      providerKey,
      (cur) => {
        if (!cur) throw new NotFoundError(`Provider not found: ${providerKey}`)
        const models = [...(cur.models ?? [])]
        if (models.some((m) => m.id === form.modelId)) {
          throw new ValidationError(`Model already exists: ${form.modelId}`)
        }
        models.push(domainModelToPi(undefined, form, providerProtocolFromPi(cur.api)))
        return { ...cur, models }
      },
      { overwrite: options?.overwrite, reason: `create model ${providerKey}/${form.modelId}` }
    )

    await this.writeModelMeta(providerKey, form.modelId, form)
    const created = (await this.list()).find(
      (m) => m.providerId === providerKey && m.modelId === form.modelId
    )
    if (!created) throw new ValidationError('Model create failed')
    return created
  }

  async update(id: string, raw: unknown, options?: WriteOptions): Promise<ModelDefinition> {
    const [oldProviderKey, ...rest] = id.split('::')
    const oldModelId = rest.join('::')
    if (!oldProviderKey || !oldModelId) throw new ValidationError(`Invalid model id: ${id}`)

    const form = this.parseForm(raw)
    const newProviderKey = form.providerId
    const newModelId = form.modelId
    const moved = newProviderKey !== oldProviderKey

    await this.config.patchModels(
      (models) => {
        const providers = { ...models.providers }
        const oldProvider = providers[oldProviderKey]
        if (!oldProvider) throw new NotFoundError(`Provider not found: ${oldProviderKey}`)

        const oldModels = [...(oldProvider.models ?? [])]
        const idx = oldModels.findIndex((m) => m.id === oldModelId)
        if (idx < 0) throw new NotFoundError(`Model not found: ${id}`)
        const existing = oldModels[idx]!

        if (!moved) {
          if (newModelId !== oldModelId && oldModels.some((m) => m.id === newModelId)) {
            throw new ValidationError(`Model id conflict: ${newModelId}`)
          }
          oldModels[idx] = domainModelToPi(existing, form, providerProtocolFromPi(oldProvider.api))
          providers[oldProviderKey] = { ...oldProvider, models: oldModels }
          return { ...models, providers }
        }

        if (oldModels.length <= 1) {
          throw new ValidationError('Provider must keep at least one model')
        }

        const newProvider = providers[newProviderKey]
        if (!newProvider) throw new NotFoundError(`Provider not found: ${newProviderKey}`)
        const destModels = [...(newProvider.models ?? [])]
        if (destModels.some((m) => m.id === newModelId)) {
          throw new ValidationError(`Model already exists: ${newProviderKey}/${newModelId}`)
        }

        oldModels.splice(idx, 1)
        providers[oldProviderKey] = { ...oldProvider, models: oldModels }
        destModels.push(domainModelToPi(existing, form, providerProtocolFromPi(newProvider.api)))
        providers[newProviderKey] = { ...newProvider, models: destModels }
        return { ...models, providers }
      },
      {
        overwrite: options?.overwrite,
        reason: moved
          ? `move model ${oldProviderKey}/${oldModelId} → ${newProviderKey}/${newModelId}`
          : `update model ${id}`
      }
    )

    const meta = await this.metadata.read()
    const modelsMeta = { ...meta.models }
    const providersMeta = { ...meta.providers }
    const oldMk = modelMetaKey(oldProviderKey, oldModelId)
    const newMk = modelMetaKey(newProviderKey, newModelId)
    const prevMeta = modelsMeta[oldMk]
    if (oldMk !== newMk) delete modelsMeta[oldMk]
    modelsMeta[newMk] = {
      ...prevMeta,
      displayName: form.displayName,
      enabled: form.enabled,
      capabilities: {
        text: true,
        vision: form.vision,
        tools: form.tools,
        reasoning: form.reasoning,
        streaming: form.streaming
      },
      updatedAt: Date.now(),
      createdAt: prevMeta?.createdAt ?? Date.now()
    }

    // If the old provider's defaultModelId pointed at this model, clear or retarget.
    const oldProvMeta = providersMeta[oldProviderKey]
    if (oldProvMeta?.defaultModelId === oldModelId) {
      providersMeta[oldProviderKey] = {
        ...oldProvMeta,
        defaultModelId: moved ? null : newModelId,
        updatedAt: Date.now()
      }
    }

    await this.metadata.write({ ...meta, models: modelsMeta, providers: providersMeta })

    // Keep settings.json active model in sync when this was the active entry.
    if (moved || newModelId !== oldModelId) {
      const active = await this.config.getActiveModel()
      if (active.providerKey === oldProviderKey && active.modelId === oldModelId) {
        await this.config.setActiveModel(newProviderKey, newModelId, {
          overwrite: options?.overwrite,
          reason: `retarget active model after edit ${oldProviderKey}/${oldModelId}`
        })
      }
    }

    const updated = (await this.list()).find(
      (m) => m.providerId === newProviderKey && m.modelId === newModelId
    )
    if (!updated) throw new ValidationError('Model update failed')
    return updated
  }

  async delete(id: string, options?: WriteOptions): Promise<void> {
    const [providerKey, ...rest] = id.split('::')
    const modelId = rest.join('::')
    if (!providerKey || !modelId) throw new ValidationError(`Invalid model id: ${id}`)

    await this.config.patchProvider(
      providerKey,
      (cur) => {
        if (!cur) throw new NotFoundError(`Provider not found: ${providerKey}`)
        const existing = cur.models ?? []
        if (existing.length <= 1) {
          throw new ValidationError('Provider must keep at least one model')
        }
        const models = existing.filter((m: PiModelConfig) => m.id !== modelId)
        if (models.length === existing.length) {
          throw new NotFoundError(`Model not found: ${id}`)
        }
        return { ...cur, models }
      },
      { overwrite: options?.overwrite, reason: `delete model ${id}` }
    )

    const meta = await this.metadata.read()
    const models = { ...meta.models }
    delete models[modelMetaKey(providerKey, modelId)]
    await this.metadata.write({ ...meta, models })
  }

  async getActive(): Promise<ActiveModel> {
    return this.config.getActiveModel()
  }

  async setActive(raw: unknown, options?: WriteOptions): Promise<ActiveModel> {
    const r = setActiveModelSchema.safeParse(raw)
    if (!r.success) throw new ValidationError('Invalid active model', { issues: r.error.issues })
    await this.config.setActiveModel(r.data.providerKey, r.data.modelId, options)
    // Read-back verify — refuse to claim success if disk differs.
    const verified = await this.config.getActiveModel()
    if (verified.providerKey !== r.data.providerKey || verified.modelId !== r.data.modelId) {
      throw new ValidationError(
        `Active model verify failed: expected ${r.data.providerKey}/${r.data.modelId}, got ${verified.providerKey}/${verified.modelId}`
      )
    }
    return verified
  }

  private parseForm(raw: unknown): ModelForm {
    const r = modelFormSchema.safeParse(raw)
    if (!r.success) throw new ValidationError('Invalid model form', { issues: r.error.issues })
    return r.data
  }

  private async writeModelMeta(
    providerKey: string,
    modelId: string,
    form: ModelForm
  ): Promise<void> {
    const meta = await this.metadata.read()
    const now = Date.now()
    await this.metadata.write({
      ...meta,
      models: {
        ...meta.models,
        [modelMetaKey(providerKey, modelId)]: {
          displayName: form.displayName,
          enabled: form.enabled,
          capabilities: {
            text: true,
            vision: form.vision,
            tools: form.tools,
            reasoning: form.reasoning,
            streaming: form.streaming
          },
          createdAt: now,
          updatedAt: now
        }
      }
    })
  }
}
