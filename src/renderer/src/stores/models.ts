import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ModelDefinition, ActiveModel } from '@shared/ipc/api-types'
import type { ModelForm } from '@shared/schemas/domain'
import { callApi, getApi } from '@renderer/composables/useApi'
import { useProvidersStore } from '@renderer/stores/providers'
import { isConfigConflict, openConflict } from '@renderer/composables/useConfigConflict'

/**
 * First attempt without overwrite so CONFIG_CONFLICT can fire.
 * On overwrite resolution, retry with overwrite:true.
 */
async function withConflictDialog<T>(
  file: 'models' | 'settings',
  source: string,
  attempt: (overwrite: boolean) => Promise<T>
): Promise<T | null> {
  try {
    return await attempt(false)
  } catch (e) {
    if (!isConfigConflict(e)) throw e
    const snapshot = await callApi(() => getApi().config.conflictSnapshot(file))
    const resolution = await openConflict(file, snapshot, { source })
    if (resolution === 'cancel') return null
    if (resolution === 'reload') {
      await callApi(() => getApi().config.reload())
      throw new Error('reload-requested')
    }
    return await attempt(true)
  }
}

export const useModelsStore = defineStore('models', () => {
  const items = ref<ModelDefinition[]>([])
  const active = ref<ActiveModel>({ providerKey: null, modelId: null })
  const loading = ref(false)
  const error = ref<string | null>(null)

  const activeLabel = computed(() => {
    if (!active.value.providerKey || !active.value.modelId) return null
    const model = items.value.find(
      (m) => m.modelId === active.value.modelId && findProviderKey(m) === active.value.providerKey
    )
    return model?.displayName ?? `${active.value.providerKey}/${active.value.modelId}`
  })

  function findProviderKey(model: ModelDefinition): string | null {
    const providers = useProvidersStore()
    return providers.items.find((p) => p.id === model.providerId)?.key ?? null
  }

  async function fetchList() {
    loading.value = true
    error.value = null
    try {
      const [list, activeModel] = await Promise.all([
        callApi(() => getApi().models.list()),
        callApi(() => getApi().models.getActive())
      ])
      items.value = list
      active.value = activeModel
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  async function create(form: ModelForm) {
    const created = await withConflictDialog(
      'models',
      `model-create:${form.modelId}`,
      (overwrite) => getApi().models.create(form, { overwrite })
    )
    if (created) await fetchList()
    return created
  }

  async function update(id: string, form: ModelForm) {
    const updated = await withConflictDialog('models', `model-update:${id}`, (overwrite) =>
      getApi().models.update(id, form, { overwrite })
    )
    if (updated) await fetchList()
    return updated
  }

  async function remove(id: string) {
    await withConflictDialog('models', `model-delete:${id}`, (overwrite) =>
      getApi().models.delete(id, { overwrite })
    )
    await fetchList()
  }

  async function setActive(providerKey: string, modelId: string) {
    const result = await withConflictDialog(
      'settings',
      `set-active:${providerKey}/${modelId}`,
      (overwrite) => getApi().models.setActive({ providerKey, modelId }, { overwrite })
    )
    if (result) {
      active.value = result
      await fetchList()
    }
    return result
  }

  function isActive(model: ModelDefinition, providerKey: string | undefined): boolean {
    if (!providerKey) return false
    return active.value.providerKey === providerKey && active.value.modelId === model.modelId
  }

  function setupListeners() {
    const api = getApi()
    return api.on('config-changed', () => {
      void fetchList()
    })
  }

  return {
    items,
    active,
    activeLabel,
    loading,
    error,
    fetchList,
    create,
    update,
    remove,
    setActive,
    isActive,
    setupListeners
  }
})
