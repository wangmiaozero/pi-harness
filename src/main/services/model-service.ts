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
import { domainModelToPi, modelToDomain } from '../pi/adapter'
import type { PiModelConfig } from '@shared/types/pi'
import { isProtocolId } from '@shared/constants/protocols'
import type { ProtocolId } from '@shared/constants/protocols'

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
      const protocol: ProtocolId = isProtocolId(provider.api ?? '')
        ? (provider.api as ProtocolId)
        : 'openai-completions'
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
        models.push(domainModelToPi(undefined, form))
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
    const [providerKey, ...rest] = id.split('::')
    const oldModelId = rest.join('::')
    if (!providerKey || !oldModelId) throw new ValidationError(`Invalid model id: ${id}`)

    const form = this.parseForm({ ...(raw as object), providerId: providerKey })

    await this.config.patchProvider(
      providerKey,
      (cur) => {
        if (!cur) throw new NotFoundError(`Provider not found: ${providerKey}`)
        const models = [...(cur.models ?? [])]
        const idx = models.findIndex((m) => m.id === oldModelId)
        if (idx < 0) throw new NotFoundError(`Model not found: ${id}`)
        if (form.modelId !== oldModelId && models.some((m) => m.id === form.modelId)) {
          throw new ValidationError(`Model id conflict: ${form.modelId}`)
        }
        models[idx] = domainModelToPi(models[idx], form)
        return { ...cur, models }
      },
      { overwrite: options?.overwrite, reason: `update model ${id}` }
    )

    const meta = await this.metadata.read()
    const models = { ...meta.models }
    if (form.modelId !== oldModelId) {
      delete models[modelMetaKey(providerKey, oldModelId)]
    }
    const mk = modelMetaKey(providerKey, form.modelId)
    models[mk] = {
      ...models[mk],
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
      createdAt: models[mk]?.createdAt ?? Date.now()
    }
    await this.metadata.write({ ...meta, models })

    const updated = (await this.list()).find(
      (m) => m.providerId === providerKey && m.modelId === form.modelId
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
        const models = (cur.models ?? []).filter((m: PiModelConfig) => m.id !== modelId)
        if (models.length === (cur.models ?? []).length) {
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
