import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  ProviderProfile,
  ConnectionTestResult,
  DiscoveredProviderModel,
  ProviderModelDiscoveryInput
} from '@shared/ipc/api-types'
import type { ProviderForm } from '@shared/schemas/domain'
import { callApi, getApi } from '@renderer/composables/useApi'
import { isConfigConflict, openConflict } from '@renderer/composables/useConfigConflict'

export const useProvidersStore = defineStore('providers', () => {
  const items = ref<ProviderProfile[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  let listRequestId = 0

  async function fetchList() {
    const requestId = ++listRequestId
    loading.value = true
    error.value = null
    try {
      const next = await callApi(() => getApi().providers.list())
      if (requestId === listRequestId) items.value = next
    } catch (e) {
      if (requestId === listRequestId) {
        error.value = (e as { message?: string }).message ?? String(e)
      }
    } finally {
      if (requestId === listRequestId) loading.value = false
    }
  }

  /**
   * First attempt without overwrite (so CONFIG_CONFLICT can fire).
   * On overwrite resolution, retry with overwrite:true.
   */
  async function withConflictDialog<T extends { key: string }>(
    source: string,
    attempt: (overwrite: boolean) => Promise<T>
  ): Promise<T | null> {
    try {
      return await attempt(false)
    } catch (e) {
      if (!isConfigConflict(e)) throw e
      const snapshot = await callApi(() => getApi().config.conflictSnapshot('models'))
      const resolution = await openConflict('models', snapshot, { source })
      if (resolution === 'cancel') return null
      if (resolution === 'reload') {
        await callApi(() => getApi().config.reload())
        await fetchList()
        throw new Error('reload-requested')
      }
      return await attempt(true)
    }
  }

  async function create(form: ProviderForm) {
    const created = await withConflictDialog('provider-create', (overwrite) =>
      getApi().providers.create(form, { overwrite })
    )
    if (created) await fetchList()
    return created
  }

  async function update(key: string, form: ProviderForm) {
    const updated = await withConflictDialog(`provider-update:${key}`, (overwrite) =>
      getApi().providers.update(key, form, { overwrite })
    )
    if (updated) await fetchList()
    return updated
  }

  async function remove(key: string) {
    await withConflictDialog(`provider-delete:${key}`, (overwrite) =>
      getApi()
        .providers.delete(key, { overwrite })
        .then(() => ({ key }))
    )
    await fetchList()
    // Cascade lives in main; refresh models so the Models page drops orphaned rows immediately.
    const { useModelsStore } = await import('@renderer/stores/models')
    await useModelsStore().fetchList()
  }

  async function duplicate(key: string) {
    const dup = await withConflictDialog(`provider-duplicate:${key}`, (overwrite) =>
      getApi().providers.duplicate(key, { overwrite })
    )
    if (dup) await fetchList()
    return dup
  }

  async function setEnabled(key: string, enabled: boolean) {
    await callApi(() => getApi().providers.setEnabled(key, enabled))
    await fetchList()
  }

  async function testConnection(
    providerKey: string,
    modelId?: string
  ): Promise<ConnectionTestResult> {
    return callApi(() => getApi().providers.testConnection({ providerKey, modelId }))
  }

  async function discoverModels(
    input: ProviderModelDiscoveryInput
  ): Promise<DiscoveredProviderModel[]> {
    return callApi(() => getApi().providers.discoverModels(input))
  }

  function setupListeners() {
    const api = getApi()
    return api.on('config-changed', () => {
      void fetchList()
    })
  }

  return {
    items,
    loading,
    error,
    fetchList,
    create,
    update,
    remove,
    duplicate,
    setEnabled,
    testConnection,
    discoverModels,
    setupListeners
  }
})
