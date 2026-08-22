import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PiEnvironment, PiInstallResult, PiLatestInfo } from '@shared/ipc/api-types'
import { callApi, getApi } from '@renderer/composables/useApi'

export const usePiStore = defineStore('pi', () => {
  const environment = ref<PiEnvironment | null>(null)
  const latest = ref<PiLatestInfo | null>(null)
  const loading = ref(false)
  const mutating = ref(false)
  const error = ref<string | null>(null)
  const lastActionLog = ref<string>('')

  const installed = computed(() => environment.value?.installed ?? false)
  const configValid = computed(() => environment.value?.configValid ?? false)
  const updateAvailable = computed(() => latest.value?.updateAvailable ?? false)
  const nodeReady = computed(() => environment.value?.nodeRuntime.ready ?? false)

  async function detect() {
    loading.value = true
    error.value = null
    try {
      environment.value = await callApi(() => getApi().pi.detect())
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  async function checkLatest() {
    try {
      latest.value = await callApi(() => getApi().pi.checkLatest())
    } catch (e) {
      // Non-fatal — registry may be unreachable
      error.value = (e as { message?: string }).message ?? String(e)
    }
  }

  async function refresh() {
    await detect()
    await checkLatest()
  }

  async function install(): Promise<PiInstallResult> {
    if (environment.value?.installed) {
      throw { message: 'Pi already installed' }
    }
    mutating.value = true
    error.value = null
    try {
      const result = await callApi(() => getApi().pi.install())
      lastActionLog.value = result.log
      await refresh()
      return result
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
      throw e
    } finally {
      mutating.value = false
    }
  }

  async function update(force = false): Promise<PiInstallResult> {
    if (!environment.value?.installed) {
      throw { message: 'Pi not installed' }
    }
    mutating.value = true
    error.value = null
    try {
      const result = await callApi(() => getApi().pi.update(force))
      lastActionLog.value = result.log
      await refresh()
      return result
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
      throw e
    } finally {
      mutating.value = false
    }
  }

  function setupListeners() {
    const api = getApi()
    return api.on('pi-environment-changed', () => {
      void refresh()
    })
  }

  return {
    environment,
    latest,
    loading,
    mutating,
    error,
    lastActionLog,
    installed,
    configValid,
    updateAvailable,
    nodeReady,
    detect,
    checkLatest,
    refresh,
    install,
    update,
    setupListeners
  }
})
