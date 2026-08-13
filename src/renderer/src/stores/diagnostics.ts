import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DiagnosticsReport } from '@shared/ipc/api-types'
import { callApi, getApi } from '@renderer/composables/useApi'

export const useDiagnosticsStore = defineStore('diagnostics', () => {
  const report = ref<DiagnosticsReport | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetch() {
    loading.value = true
    error.value = null
    try {
      report.value = await callApi(() => getApi().diagnostics.get())
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  async function copyToClipboard(): Promise<string> {
    const text = await callApi(() => getApi().diagnostics.copy())
    await navigator.clipboard.writeText(text)
    return text
  }

  async function exportReport(): Promise<string> {
    return callApi(() => getApi().diagnostics.export())
  }

  return {
    report,
    loading,
    error,
    fetch,
    copyToClipboard,
    exportReport
  }
})
