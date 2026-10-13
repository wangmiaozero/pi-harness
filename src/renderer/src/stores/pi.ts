import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  EnvironmentInstallTask,
  PiEnvironment,
  PiInstallResult,
  PiLatestInfo
} from '@shared/ipc/api-types'
import { callApi, getApi } from '@renderer/composables/useApi'
import { useSettingsStore } from './settings'

const SUCCESS_TASK_DISMISS_MS = 4_000
const ENVIRONMENT_FRESH_MS = 30_000

export const usePiStore = defineStore('pi', () => {
  const environment = ref<PiEnvironment | null>(null)
  const latest = ref<PiLatestInfo | null>(null)
  const loading = ref(false)
  const actionPending = ref(false)
  const installTask = ref<EnvironmentInstallTask | null>(null)
  const error = ref<string | null>(null)
  const lastActionLog = ref<string>('')
  let taskDismissTimer: ReturnType<typeof setTimeout> | null = null
  let detectRequest: Promise<void> | null = null
  let latestRequest: Promise<void> | null = null
  let detectedAt: number | null = null
  let latestAt: number | null = null
  let detectedSettings: string | null = null
  let latestSettings: string | null = null
  let environmentRevision = 0

  function environmentSettings(): string {
    const settings = useSettingsStore().settings
    return JSON.stringify([settings?.manualCliPath ?? null, settings?.manualConfigDir ?? null])
  }

  function invalidate(): void {
    environmentRevision++
    detectedAt = null
    latestAt = null
  }

  const installed = computed(() => environment.value?.installed ?? false)
  const configValid = computed(() => environment.value?.configValid ?? false)
  const updateAvailable = computed(() => latest.value?.updateAvailable ?? false)
  const nodeReady = computed(() => environment.value?.nodeRuntime.ready ?? false)
  const mutating = computed(() => actionPending.value || installTask.value?.state === 'running')

  function setInstallTask(task: EnvironmentInstallTask | null): void {
    if (taskDismissTimer) {
      clearTimeout(taskDismissTimer)
      taskDismissTimer = null
    }
    installTask.value = task
    if (task?.state !== 'success') return

    const elapsed = task.finishedAt ? Math.max(0, Date.now() - task.finishedAt) : 0
    const remaining = SUCCESS_TASK_DISMISS_MS - elapsed
    if (remaining <= 0) {
      installTask.value = null
      return
    }
    taskDismissTimer = setTimeout(() => {
      if (installTask.value?.id === task.id && installTask.value.state === 'success') {
        installTask.value = null
      }
      taskDismissTimer = null
    }, remaining)
  }

  function detect(): Promise<void> {
    if (detectRequest) return detectRequest

    loading.value = true
    error.value = null
    detectedAt = null
    const revision = environmentRevision
    const settings = environmentSettings()
    detectRequest = (async () => {
      try {
        const next = await callApi(() => getApi().pi.detect())
        if (revision === environmentRevision) {
          environment.value = next
          detectedAt = Date.now()
          detectedSettings = settings
        }
      } catch (e) {
        if (revision === environmentRevision)
          error.value = (e as { message?: string }).message ?? String(e)
      } finally {
        loading.value = false
        detectRequest = null
      }
    })()
    return detectRequest
  }

  function checkLatest(): Promise<void> {
    if (latestRequest) return latestRequest
    latestAt = null
    const revision = environmentRevision
    const settings = environmentSettings()
    latestRequest = (async () => {
      try {
        const next = await callApi(() => getApi().pi.checkLatest())
        if (revision === environmentRevision) {
          latest.value = next
          latestAt = Date.now()
          latestSettings = settings
        }
      } catch (e) {
        // Non-fatal — registry may be unreachable
        if (revision === environmentRevision)
          error.value = (e as { message?: string }).message ?? String(e)
      } finally {
        latestRequest = null
      }
    })()
    return latestRequest
  }

  /** Navigation reuses recent checks; explicit refresh and mutations always detect. */
  async function ensureFresh(): Promise<void> {
    const settings = environmentSettings()
    if (
      !environment.value ||
      detectedSettings !== settings ||
      detectedAt === null ||
      Date.now() - detectedAt >= ENVIRONMENT_FRESH_MS
    ) {
      await detect()
    }
    if (
      !latest.value ||
      latestSettings !== settings ||
      latestAt === null ||
      Date.now() - latestAt >= ENVIRONMENT_FRESH_MS
    ) {
      await checkLatest()
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
      setInstallTask(result)
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
    setInstallTask(await callApi(() => getApi().pi.cancelInstall()))
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
      invalidate()
      const next = payload as PiEnvironment
      if (next?.nodeRuntime) {
        environment.value = next
        detectedAt = Date.now()
        detectedSettings = environmentSettings()
      } else void refresh()
    })
    const removeConfig = api.on('config-changed', invalidate)
    const removeTask = api.on('environment-install-task', (payload) => {
      setInstallTask(payload)
      if (payload.logs.length) {
        lastActionLog.value = payload.logs.map((entry) => entry.message).join('\n')
      }
    })
    void api.pi.getInstallTask().then((task) => {
      setInstallTask(task)
    })
    return () => {
      if (taskDismissTimer) {
        clearTimeout(taskDismissTimer)
        taskDismissTimer = null
      }
      removeEnvironment()
      removeConfig()
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
    ensureFresh,
    install,
    bootstrap,
    installNode,
    reinstall,
    cancelInstall,
    update,
    setupListeners
  }
})
