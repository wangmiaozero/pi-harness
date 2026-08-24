import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  EnvironmentInstallTask,
  PiEnvironment,
  PiInstallResult,
  PiLatestInfo
} from '@shared/ipc/api-types'
import { callApi, getApi } from '@renderer/composables/useApi'

export const usePiStore = defineStore('pi', () => {
  const environment = ref<PiEnvironment | null>(null)
  const latest = ref<PiLatestInfo | null>(null)
  const loading = ref(false)
  const actionPending = ref(false)
  const installTask = ref<EnvironmentInstallTask | null>(null)
  const error = ref<string | null>(null)
  const lastActionLog = ref<string>('')

  const installed = computed(() => environment.value?.installed ?? false)
  const configValid = computed(() => environment.value?.configValid ?? false)
  const updateAvailable = computed(() => latest.value?.updateAvailable ?? false)
  const nodeReady = computed(() => environment.value?.nodeRuntime.ready ?? false)
  const mutating = computed(() => actionPending.value || installTask.value?.state === 'running')

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
    actionPending.value = true
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
      actionPending.value = false
    }
  }

  async function bootstrap(): Promise<PiInstallResult> {
    actionPending.value = true
    error.value = null
    try {
      const result = await callApi(() => getApi().pi.bootstrap())
      lastActionLog.value = result.log
      await refresh()
      return result
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
      throw e
    } finally {
      actionPending.value = false
    }
  }

  async function installNode(): Promise<EnvironmentInstallTask> {
    actionPending.value = true
    error.value = null
    try {
      const result = await callApi(() => getApi().pi.installNode())
      installTask.value = result
      lastActionLog.value = result.logs.map((entry) => entry.message).join('\n')
      await detect()
      return result
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
      throw e
    } finally {
      actionPending.value = false
    }
  }

  async function reinstall(): Promise<PiInstallResult> {
    actionPending.value = true
    error.value = null
    try {
      const result = await callApi(() => getApi().pi.reinstall())
      lastActionLog.value = result.log
      await refresh()
      return result
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
      throw e
    } finally {
      actionPending.value = false
    }
  }

  async function cancelInstall(): Promise<void> {
    installTask.value = await callApi(() => getApi().pi.cancelInstall())
    await detect()
  }

  async function update(force = false): Promise<PiInstallResult> {
    if (!environment.value?.installed) {
      throw { message: 'Pi not installed' }
    }
    actionPending.value = true
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
      actionPending.value = false
    }
  }

  function setupListeners() {
    const api = getApi()
    const removeEnvironment = api.on('pi-environment-changed', (payload) => {
      const next = payload as PiEnvironment
      if (next?.nodeRuntime) environment.value = next
      else void refresh()
    })
    const removeTask = api.on('environment-install-task', (payload) => {
      installTask.value = payload
      if (payload.logs.length) {
        lastActionLog.value = payload.logs.map((entry) => entry.message).join('\n')
      }
    })
    void api.pi.getInstallTask().then((task) => {
      installTask.value = task
    })
    return () => {
      removeEnvironment()
      removeTask()
    }
  }

  return {
    environment,
    latest,
    installTask,
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
    bootstrap,
    installNode,
    reinstall,
    cancelInstall,
    update,
    setupListeners
  }
})
